// LOCAL TEST ONLY. These numbers are not real contacts.
// +254700000301 nearest approved electrician, on duty, 15 km
// +254700000303 and +254700000304 are farther electricians, for the emergency offer
// +254700000302 operator
// Refuses --remote so this cannot be applied to production.

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

if (process.argv.includes("--remote")) {
  console.error("This seed is for wrangler dev only. It will not run against the remote database.");
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const people = [
  ["+254700000301", "Local test electrician", "technician", -1.2921, 36.8219, 4],
  ["+254700000303", "Local test electrician two", "technician", -1.3, 36.83, 5],
  ["+254700000304", "Local test electrician three", "technician", -1.31, 36.84, 3],
  ["+254700000302", "Local test operator", "operator", null, null, 0],
];
const statements = people.map(([phone, name, role, lat, lng, rating]) => {
  const id = randomUUID();
  const user = `INSERT INTO users (id, phone, name, role, status, created_at)
VALUES ('${id}', '${phone}', '${name}', '${role}', 'active', ${now})
ON CONFLICT(phone) DO UPDATE SET role = '${role}', status = 'active';`;
  if (role !== "technician") return user;
  return `${user}
INSERT INTO technician_profiles (user_id, trades, base_lat, base_lng, radius_km, on_duty, approved, rating_avg, rating_count)
SELECT id, 'electrical', ${lat}, ${lng}, 15, 1, 1, ${rating}, 1 FROM users WHERE phone = '${phone}'
ON CONFLICT(user_id) DO UPDATE SET
  trades = 'electrical', base_lat = ${lat}, base_lng = ${lng}, radius_km = 15, on_duty = 1, approved = 1, rating_avg = ${rating};`;
});
const sql = statements.join("\n");

const result = spawnSync(
  "npx",
  ["wrangler", "d1", "execute", "nurumaji-db", "--local", "--command", sql],
  { stdio: "inherit" }
);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log("Local test technicians +254700000301, +254700000303, +254700000304 and operator +254700000302 are ready.");
