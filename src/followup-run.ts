import { dispatchJob } from "./dispatch-run";
import { returnVisitDescription } from "./followups.mjs";
import type { Bindings } from "./types";

type OriginalJob = {
  id: string;
  clientId: string;
  trade: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
};

// One return visit per failed sheet. A second call for the same sheet does nothing.
export async function createReturnVisit(env: Bindings, input: {
  sheetId: string;
  original: OriginalJob;
  readings: Record<string, string | number>;
  notes: string;
  actorId: string;
  now: number;
}): Promise<void> {
  const existing = await env.DB.prepare("SELECT id FROM job_followups WHERE sheet_id = ?").bind(input.sheetId).first();
  if (existing) return;
  const returnId = crypto.randomUUID();
  const description = returnVisitDescription(input.readings, input.notes);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO jobs (id, client_id, trade, description, urgency, address, lat, lng, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'urgent', ?, ?, ?, 'new', ?, ?)`
    ).bind(returnId, input.original.clientId, input.original.trade, description, input.original.address, input.original.lat, input.original.lng, input.now, input.now),
    env.DB.prepare(
      "INSERT INTO job_events (id, job_id, actor_id, type, note, created_at) VALUES (?, ?, ?, 'created', ?, ?)"
    ).bind(crypto.randomUUID(), returnId, input.actorId, "Follow-up visit booked", input.now),
    env.DB.prepare(
      `INSERT INTO job_followups (id, sheet_id, original_job_id, return_job_id, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), input.sheetId, input.original.id, returnId, input.now),
    env.DB.prepare(
      "INSERT INTO audit_log (id, actor_id, action, details_json, created_at) VALUES (?, ?, 'return_visit_created', ?, ?)"
    ).bind(crypto.randomUUID(), input.actorId, JSON.stringify({
      originalJobId: input.original.id,
      returnJobId: returnId,
      sheetId: input.sheetId,
    }), input.now),
  ]);
  try {
    await dispatchJob(env, returnId);
  } catch (error) {
    console.error(error);
  }
}
