const EXCLUDED = new Set(["otp_codes", "sessions", "invites", "rating_invites"]);

export function backupKey(date) {
  return `backups/${date}.json`;
}

export function shouldBackup(hour, lastDate, today) {
  return hour === 2 && lastDate !== today;
}

export function isBackupTable(name) {
  if (!name || name.startsWith("sqlite_") || name.startsWith("_cf") || name.startsWith("d1_")) return false;
  return !EXCLUDED.has(name);
}

export function expiredBackupKeys(keys, today, keepDays = 30) {
  const cutoff = shiftDate(today, -keepDays);
  return keys.filter((key) => {
    const match = String(key).match(/^backups\/(\d{4}-\d{2}-\d{2})\.json$/);
    return Boolean(match && match[1] < cutoff);
  });
}

function shiftDate(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (value) => String(value).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}
