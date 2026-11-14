import { closeReportText, reportSettingsFromStore } from "./job-report.mjs";
import { sendCustomerMessage } from "./sms";
import type { Bindings } from "./types";

const KEYS = ["close_photos_required", "close_report_sms", "warranty_repair_days", "warranty_install_months", "whatsapp_report_template"];

export async function readReportSettings(env: Bindings) {
  try {
    const rows = await env.DB.prepare(
      `SELECT key, value FROM settings WHERE key IN (${KEYS.map(() => "?").join(", ")})`
    ).bind(...KEYS).all<{ key: string; value: string }>();
    return reportSettingsFromStore(Object.fromEntries((rows.results ?? []).map((row) => [row.key, row.value])));
  } catch {
    return reportSettingsFromStore({});
  }
}

export async function notifyJobReport(env: Bindings, jobId: string, clientId: string): Promise<void> {
  const settings = await readReportSettings(env);
  if (!settings.sms) return;
  const client = await env.DB.prepare(
    "SELECT phone FROM users WHERE id = ? AND status = 'active'"
  ).bind(clientId).first<{ phone: string }>();
  if (!client?.phone) return;
  const base = (env.APP_URL || "").replace(/\/$/, "");
  const url = `${base}/portal/jobs/${jobId}/report`;
  await sendCustomerMessage(env, client.phone, closeReportText(url), "job report ready", settings.template);
}
