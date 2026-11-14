export const INSPECTION_PRICE_DEFAULT: string;
export const INSPECTION_PARTNER_LINE: string;

export function defaultNextDue(inspectedOn: string): string;
export function nairobiDate(seconds: number): string;
export function validateInspection(raw: Record<string, unknown>, today: string): {
  error: string;
  readings?: never;
} | {
  error?: never;
  readings: {
    insulationMohm: number;
    zsOhm: number;
    rcdMs: number;
    polarity: string;
    visibleDamage: string;
    overloaded: string;
  };
  recommendations: string;
  result: string;
  inspectedOn: string;
  nextDue: string;
};
export function inspectionPriceLine(value: string | undefined): string;
export function parseInspectionSettings(input: { price?: unknown; sms?: unknown }): {
  ok: false;
  error: string;
} | {
  ok: true;
  price: string;
  sms: boolean;
};
export function inspectionReminderDue(input: {
  today: string;
  nextDue: string | null;
  sentOn: string | null;
  smsOn: boolean;
  optedOut: boolean;
  hour: number;
}): boolean;
export function inspectionReminderText(): string;
export function inspectionReportLines(input: {
  address?: string | null;
  inspectedOn: string;
  inspectorName?: string | null;
  readings: Record<string, string | number>;
  result: string;
  nextDue: string;
  recommendations?: string | null;
}): string[];
