export const SERVICES: Record<string, { trade: "electrical" | "plumbing"; label: string }>;
export function lookupService(key: unknown): { key: string; trade: "electrical" | "plumbing"; label: string } | null;
