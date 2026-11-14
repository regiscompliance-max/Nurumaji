export const QUOTE_FOLLOWUP_DEFAULTS: { days: number; finalDays: null; sms: boolean; template: string };

export function parseQuoteFollowUpSettings(input: { days: unknown; finalDays?: unknown; sms?: unknown; template?: unknown }): {
  ok: false;
  error: string;
} | {
  ok: true;
  days: number;
  finalDays: number | null;
  sms: boolean;
  template: string;
};
export function quoteFollowUpSettingsFromStore(values: Record<string, string | undefined>): {
  days: number;
  finalDays: number | null;
  sms: boolean;
  template: string;
};
export function quoteFollowUpDue(input: {
  now: number;
  sentAt: number | null;
  status: string;
  days: number;
  finalDays: number | null;
  sentKinds: string[];
}): "first" | "final" | null;
export function quoteFollowUpText(kind: string): string;
export function quoteFollowUpDetail(kind: string): string;
