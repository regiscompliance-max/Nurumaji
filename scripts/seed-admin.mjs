import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { normalizeKenyanMobile } from "../src/phone.mjs";

const phone = normalizeKenyanMobile(process.env.ADMIN_PHONE || "");
if (!phone) {
  console.error("Set ADMIN_PHONE to a Kenyan mobile number, for example +254712345678.");
  process.exit(1);
}

const remote = process.argv.includes("--remote");
const now = Math.floor(Date.now() / 1000);
const sql = `INSERT INTO users (id, phone, name, role, status, created_at)
VALUES ('${randomUUID()}', '${phone}', NULL, 'admin', 'active', ${now})
ON CONFLICT(phone) DO UPDATE SET role = 'admin', status = 'active';`;

const result = spawnSync(
  "npx",
  ["wrangler", "d1", "execute", "nurumaji-db", remote ? "--remote" : "--local", "--command", sql],
  { stdio: "inherit" }
);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Admin is ${phone}. They can sign in with a text code.`);
