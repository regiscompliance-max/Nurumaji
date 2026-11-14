export const EMERGENCY_DEFAULTS: {
  bookings: boolean;
  minKes: number;
  nightPercent: number;
  weekendPercent: number;
  targetHours: number;
  showTarget: boolean;
  alert: boolean;
  servicesNumber: string;
  template: string;
};

export const EMERGENCY_PROBLEMS: Record<string, { trade: "electrical" | "plumbing"; label: string }>;

export function parseEmergencySettings(input: {
  bookings?: unknown;
  minKes?: unknown;
  nightPercent?: unknown;
  weekendPercent?: unknown;
  targetHours?: unknown;
  showTarget?: unknown;
  alert?: unknown;
  servicesNumber?: unknown;
  template?: unknown;
}): {
  ok: false;
  error: string;
} | {
  ok: true;
  bookings: boolean;
  minKes: number;
  nightPercent: number;
  weekendPercent: number;
  targetHours: number;
  showTarget: boolean;
  alert: boolean;
  servicesNumber: string;
  template: string;
};

export function emergencySettingsFromStore(values: Record<string, string | undefined>): {
  bookings: boolean;
  minKes: number;
  nightPercent: number;
  weekendPercent: number;
  targetHours: number;
  showTarget: boolean;
  alert: boolean;
  servicesNumber: string;
  template: string;
};

export function nairobiWeekday(seconds: number): number;
export function bookingWindow(seconds: number): { night: boolean; weekend: boolean };
export function safetyLine(servicesNumber: string | undefined): string;
export function emergencyNotice(settings: {
  minKes: number;
  nightPercent: number;
  weekendPercent: number;
  targetHours: number;
  showTarget: boolean;
  servicesNumber?: string;
}, now: number): string[];
export function emergencyAlertText(targetHours: number): string;
export function dispatchRank(urgency: string): number;
export function emergencyProblem(key: unknown): { key: string; trade: "electrical" | "plumbing"; label: string } | null;
