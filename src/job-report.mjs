export const PHOTO_LIMIT = 4;
export const PHOTO_BYTES = 5 * 1024 * 1024;

export const REPORT_DEFAULTS = {
  photosRequired: false,
  sms: false,
  repairDays: 90,
  installMonths: 12,
  template: "nurumaji_job_report",
};

const KINDS = new Set(["attachment", "before", "after"]);

function wholeNumber(value, min, max) {
  const text = String(value ?? "").trim();
  if (!/^[0-9]+$/.test(text)) return null;
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function flag(value) {
  return value === true || value === "1" || value === "on";
}

export function photoKind(value) {
  const kind = String(value || "");
  return KINDS.has(kind) ? kind : "attachment";
}

export function parseReportSettings(input) {
  const repairDays = wholeNumber(input.repairDays, 1, 3650);
  const installMonths = wholeNumber(input.installMonths, 1, 120);
  if (repairDays == null) return { ok: false, error: "Repair cover must be a whole number of days from 1 to 3650." };
  if (installMonths == null) return { ok: false, error: "Installation cover must be a whole number of months from 1 to 120." };
  const template = String(input.template ?? "").trim();
  if (template && !/^[a-z0-9_]{1,64}$/.test(template)) {
    return { ok: false, error: "The template name can use lowercase letters, numbers, and underscores." };
  }
  return {
    ok: true,
    photosRequired: flag(input.photosRequired),
    sms: flag(input.sms),
    repairDays,
    installMonths,
    template: template || REPORT_DEFAULTS.template,
  };
}

export function reportSettingsFromStore(values) {
  const parsed = parseReportSettings({
    photosRequired: values.close_photos_required === "1",
    sms: values.close_report_sms === "1",
    repairDays: values.warranty_repair_days ?? String(REPORT_DEFAULTS.repairDays),
    installMonths: values.warranty_install_months ?? String(REPORT_DEFAULTS.installMonths),
    template: values.whatsapp_report_template,
  });
  if (!parsed.ok) return { ...REPORT_DEFAULTS };
  return parsed;
}

export function canCloseJob({ required, beforeCount, afterCount }) {
  if (!required) return { ok: true };
  if (beforeCount >= 1 && afterCount >= 1) return { ok: true };
  return { ok: false, error: "Add at least one before photo and one after photo before closing the job." };
}

export function canMarkForMarketing({ consent, requested }) {
  if (!requested) return { ok: true, value: 0 };
  if (!consent) return { ok: false, error: "The client has not agreed that photos of the work may be used." };
  return { ok: true, value: 1 };
}

export function warrantyLine(repairDays, installMonths) {
  return `Workmanship on a repair is covered for ${repairDays} days. Workmanship on an installation is covered for ${installMonths} months. The written quote says which applies.`;
}

export function closeReportText(url) {
  return `Nuru & Maji: your job report is ready. Sign in to read it: ${url}`;
}

export function withinPhotoLimit(already, incoming) {
  if (incoming < 1) return { ok: true };
  if (incoming > PHOTO_LIMIT || already + incoming > PHOTO_LIMIT) {
    return { ok: false, error: `Attach up to ${PHOTO_LIMIT} photos of this kind.` };
  }
  return { ok: true };
}
