export function shiftNairobiDate(iso: string, days: number): string;
export function nairobiMidnight(iso: string): number;
export function nairobiWeekday(iso: string): number;
export function reportWindow(kind: string, now: number): { kind: string; start: number; end: number; label: string };
export function dueDigests(now: number): { period: "day" | "week"; start: number; end: number; label: string }[];
export function snapshotMissing(savedStarts: number[], periodStart: number): boolean;
export function owedAt(invoices: { status: string; issuedAt: number | null; paidAt: number | null; dueAt: number | null; amountKes: number }[], windowEnd: number): { owedKes: number; overdueKes: number };
export function formatDuration(seconds: number | null): string | null;
export function digestText(period: string, stats: { booked: number; completed: number; collectedTotal: number; overdueKes: number; stuckOpen: number }): string;
