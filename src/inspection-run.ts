import { INSPECTION_PRICE_DEFAULT, inspectionPriceLine, inspectionReminderDue, inspectionReminderText, nairobiDate } from "./inspection.mjs";
import { nairobiParts } from "./payments.mjs";
import { sendSms } from "./sms";
import type { Bindings } from "./types";

export async function readInspectionPrice(env: Bindings): Promise<string> {
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'inspection_price_from'").first<{ value: string }>();
    return inspectionPriceLine(row ? row.value : INSPECTION_PRICE_DEFAULT);
  } catch {
    return inspectionPriceLine(INSPECTION_PRICE_DEFAULT);
  }
}

// Runs from the existing every-minute schedule. The text stays off until an admin switches it on.
export async function checkInspectionReminders(env: Bindings): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const hour = nairobiParts(now).hour;
  const today = nairobiDate(now);
  let smsOn = false;
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'inspection_reminder_sms'").first<{ value: string }>();
    smsOn = row?.value === "1";
  } catch {
    return;
  }
  if (!smsOn || hour < 8 || hour >= 19) return;
  let due: { results?: { id: string; next_due_on: string; reminder_sent_on: string | null; phone: string | null; opted_out: number }[] };
  try {
    due = await env.DB.prepare(
      `SELECT safety_inspections.id, safety_inspections.next_due_on, safety_inspections.reminder_sent_on,
              users.phone, users.followup_opt_out AS opted_out
       FROM safety_inspections
       JOIN jobs ON jobs.id = safety_inspections.job_id
       JOIN users ON users.id = jobs.client_id
       WHERE safety_inspections.reminder_sent_on IS NULL AND safety_inspections.next_due_on <= ?`
    ).bind(today).all();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("no such table") || message.includes("no such column")) {
      console.error("Inspection reminders skipped until migration 0019 is applied.");
      return;
    }
    throw error;
  }
  for (const row of due.results ?? []) {
    if (!inspectionReminderDue({
      today,
      nextDue: row.next_due_on,
      sentOn: row.reminder_sent_on,
      smsOn: true,
      optedOut: row.opted_out === 1,
      hour,
    }) || !row.phone) continue;
    await sendSms(env, row.phone, inspectionReminderText());
    await env.DB.prepare(
      "UPDATE safety_inspections SET reminder_sent_on = ? WHERE id = ? AND reminder_sent_on IS NULL"
    ).bind(today, row.id).run();
  }
}
