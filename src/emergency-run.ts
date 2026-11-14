import { emergencyAlertText, emergencySettingsFromStore } from "./emergency.mjs";
import { sendCustomerMessage } from "./sms";
import type { Bindings } from "./types";

const KEYS = [
  "emergency_bookings",
  "emergency_min_kes",
  "emergency_night_percent",
  "emergency_weekend_percent",
  "emergency_target_hours",
  "emergency_show_target",
  "emergency_alert",
  "emergency_services_number",
  "whatsapp_emergency_template",
];

export async function readEmergencySettings(env: Bindings) {
  try {
    const rows = await env.DB.prepare(
      `SELECT key, value FROM settings WHERE key IN (${KEYS.map(() => "?").join(", ")})`
    ).bind(...KEYS).all<{ key: string; value: string }>();
    return emergencySettingsFromStore(Object.fromEntries((rows.results ?? []).map((row) => [row.key, row.value])));
  } catch {
    return emergencySettingsFromStore({});
  }
}

export async function notifyEmergencyBooking(env: Bindings): Promise<void> {
  const settings = await readEmergencySettings(env);
  if (!settings.alert) return;
  const text = emergencyAlertText(settings.targetHours);
  let phones: string[] = [];
  try {
    const admins = await env.DB.prepare(
      "SELECT phone FROM users WHERE role = 'admin' AND status = 'active'"
    ).all<{ phone: string }>();
    const onCall = await env.DB.prepare(
      `SELECT users.phone FROM users
       JOIN technician_profiles ON technician_profiles.user_id = users.id
       WHERE users.role = 'technician' AND users.status = 'active' AND technician_profiles.on_call = 1`
    ).all<{ phone: string }>();
    phones = [...(admins.results ?? []), ...(onCall.results ?? [])].map((row) => row.phone);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("no such column")) {
      console.error("Emergency alerts skipped until migration 0020 is applied.");
      return;
    }
    throw error;
  }
  for (const phone of [...new Set(phones)]) {
    await sendCustomerMessage(env, phone, text, "new emergency booking", settings.template);
  }
}
