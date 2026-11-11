export const PAYMENT_DEFAULTS: { dueDays: number; offsets: number[]; sms: boolean };

export function nairobiParts(seconds: number): { date: string; hour: number };
export function daysPastDue(dueAt: number, now: number): number;
export function owedBucket(days: number): "0-7" | "8-30" | "30+" | null;
export function parseOffsets(value: unknown): { error: string; offsets?: never } | { error?: never; offsets: number[] };
export function parsePaymentSettings(input: { dueDays: unknown; offsets: unknown; sms?: unknown }): {
  ok: false;
  error: string;
} | {
  ok: true;
  dueDays: number;
  offsets: number[];
  sms: boolean;
};
export function paymentSettingsFromStore(values: Record<string, string | undefined>): {
  dueDays: number;
  offsets: number[];
  sms: boolean;
};
export function reminderToSend(input: {
  now: number;
  dueAt: number | null;
  status: string;
  paused: boolean;
  offsets: number[];
  sentOffsets: number[];
}): number | null;
export function invoiceReference(id: string): string;
export function paymentReminderText(input: { reference: string; amountKes: number; offsetDays: number }): string;
