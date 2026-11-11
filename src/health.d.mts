export function healthSlot(date: string, hour: number): string;
export function parseAtBalance(payload: unknown): number | null;
export function healthWarning(input: { databaseOk: boolean; portalOk: boolean; balance: number | null; threshold: number }): string | null;
export function redactSecret(text: string, secret: string | undefined): string;
