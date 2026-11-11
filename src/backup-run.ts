import { backupKey, expiredBackupKeys, isBackupTable, shouldBackup } from "./backup.mjs";
import { nairobiParts } from "./payments.mjs";
import type { Bindings } from "./types";

async function setting(env: Bindings, key: string): Promise<string> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value || "";
}

async function save(env: Bindings, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).bind(key, value).run();
}

export async function nightlyBackup(env: Bindings): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const parts = nairobiParts(now);
  if (!shouldBackup(parts.hour, await setting(env, "backup_last_on"), parts.date)) return;
  if (!env.UPLOADS) {
    await save(env, "backup_last_on", parts.date);
    await save(env, "backup_last_status", "failed");
    await save(env, "backup_last_key", "");
    return;
  }
  try {
    const names = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    ).all<{ name: string }>();
    const tables: Record<string, unknown[]> = {};
    for (const row of names.results ?? []) {
      if (!isBackupTable(row.name)) continue;
      const data = await env.DB.prepare(`SELECT * FROM ${quoteIdent(row.name)}`).all();
      tables[row.name] = data.results ?? [];
    }
    const key = backupKey(parts.date);
    await env.UPLOADS.put(key, JSON.stringify({ exportedAt: new Date(now * 1000).toISOString(), tables }), {
      httpMetadata: { contentType: "application/json" },
    });
    const listed = await env.UPLOADS.list({ prefix: "backups/" });
    for (const name of expiredBackupKeys((listed.objects ?? []).map((item) => item.key), parts.date)) {
      await env.UPLOADS.delete(name);
    }
    await save(env, "backup_last_on", parts.date);
    await save(env, "backup_last_status", "ok");
    await save(env, "backup_last_key", key);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Backup failed.");
    await save(env, "backup_last_on", parts.date);
    await save(env, "backup_last_status", "failed");
  }
}

function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error("Unexpected table name.");
  return `"${name}"`;
}
