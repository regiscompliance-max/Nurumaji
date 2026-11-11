export function followUpKind(trade: string, description: string): "electrical_check" | "water_heater" | null;
export function addMonths(iso: string, months: number): string;
export function isDue(completedOn: string, today: string, months: number): boolean;
export function shouldTextClient(smsOn: boolean, optedOut: boolean): boolean;
export function followUpText(kind: string): string;
