export const STUCK_DEFAULTS: {
  awaitingMinutes: number;
  notStartedHours: number;
  inProgressHours: number;
  sms: boolean;
};

export function parseStuckSettings(input: {
  awaitingMinutes: unknown;
  notStartedHours: unknown;
  inProgressHours: unknown;
  sms?: unknown;
}): {
  error: string;
  awaitingMinutes?: never;
  notStartedHours?: never;
  inProgressHours?: never;
  sms?: never;
} | {
  error?: never;
  awaitingMinutes: number;
  notStartedHours: number;
  inProgressHours: number;
  sms: boolean;
};

export function thresholdsFromSettings(values: Record<string, string | undefined>): {
  awaitingMinutes: number;
  notStartedHours: number;
  inProgressHours: number;
  sms: boolean;
};

export function classifyStuck(
  job: {
    status: string;
    createdAt: number;
    updatedAt?: number | null;
    assignedAt?: number | null;
    startedAt?: number | null;
    assignedTechId?: string | null;
    operatorFlag?: number;
  },
  thresholds: { awaitingMinutes: number; notStartedHours: number; inProgressHours: number },
  now: number,
): { reason: string; ageSeconds: number; anchorAt: number } | null;

export function isNewEpisode(openAlerts: { jobId: string; reason: string; resolvedAt: number | null }[], jobId: string, reason: string): boolean;
export function reasonLabel(reason: string): string;
export function formatAge(seconds: number): string;
export function stuckAlertSms(items: { trade: string; area?: string | null; reason: string; ageSeconds: number }[]): string;
