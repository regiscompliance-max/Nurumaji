export function daysUntilExpiry(expiry: string, today: string): number | null;
export function reminderOffset(days: number | null): number | null;
export function dispatchHold(docs: { docType: string; expiryDate: string }[], today: string): string | null;
export function documentLabel(type: string): string;
