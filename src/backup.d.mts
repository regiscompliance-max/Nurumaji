export function backupKey(date: string): string;
export function shouldBackup(hour: number, lastDate: string, today: string): boolean;
export function isBackupTable(name: string): boolean;
export function expiredBackupKeys(keys: string[], today: string, keepDays?: number): string[];
