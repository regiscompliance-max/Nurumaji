export function jobReference(id: string): string;
export function returnVisitDescription(readings: Record<string, string | number>, notes?: string | null): string;
export function preferOriginalTechnician<T extends { userId: string }>(ranked: T[], originalUserId: string | null): T[];
