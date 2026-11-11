export function validateTestSheet(trade: string, raw: Record<string, unknown>): {
  error: string;
  readings?: never;
  result?: never;
  notes?: never;
} | {
  error?: never;
  readings: Record<string, string | number>;
  result: string;
  notes: string;
};
