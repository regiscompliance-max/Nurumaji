export const PHOTO_LIMIT: number;
export const PHOTO_BYTES: number;
export const REPORT_DEFAULTS: {
  photosRequired: boolean;
  sms: boolean;
  repairDays: number;
  installMonths: number;
  template: string;
};

export function photoKind(value: unknown): "attachment" | "before" | "after";
export function parseReportSettings(input: {
  photosRequired?: unknown;
  sms?: unknown;
  repairDays?: unknown;
  installMonths?: unknown;
  template?: unknown;
}): {
  ok: false;
  error: string;
} | {
  ok: true;
  photosRequired: boolean;
  sms: boolean;
  repairDays: number;
  installMonths: number;
  template: string;
};
export function reportSettingsFromStore(values: Record<string, string | undefined>): {
  photosRequired: boolean;
  sms: boolean;
  repairDays: number;
  installMonths: number;
  template: string;
};
export function canCloseJob(input: { required: boolean; beforeCount: number; afterCount: number }): { ok: true } | { ok: false; error: string };
export function canMarkForMarketing(input: { consent: boolean; requested: boolean }): { ok: true; value: number } | { ok: false; error: string };
export function warrantyLine(repairDays: number, installMonths: number): string;
export function closeReportText(url: string): string;
export function withinPhotoLimit(already: number, incoming: number): { ok: true } | { ok: false; error: string };
