// Local backup: every table as JSON, the sign-in accounts list, and all ticket photos, into a dated folder on this PC.
// Usage: node --env-file=.env.local scripts/backup.mjs [target folder]   (default D:\Pandora Backups)
// Keeps the newest 30 backups and deletes older ones from the target folder.
import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { join, dirname } from "node:path";

const TABLES = [
  "app_settings", "audit_log", "batch_items", "branches", "customers", "diagnoses", "dispatch_batches", "email_outbox",
  "erp_sync_exclusions", "erp_sync_runs", "fault_categories", "integration_outbox", "item_cost_links", "location_movements",
  "notification_log", "parts_consumption", "payments", "profiles", "quotations", "report_access", "reports",
  "role_change_requests", "sales_persons", "sla_rules", "status_history", "status_transitions", "ticket_media", "tickets", "user_branches",
];
const KEEP = 30;
const PAGE = 1000;

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const root = process.argv[2] || "D:\\Pandora Backups";
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const dir = join(root, stamp);
await mkdir(join(dir, "tables"), { recursive: true });

const counts = {};
for (const table of TABLES) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select("*").range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  await writeFile(join(dir, "tables", `${table}.json`), JSON.stringify(rows, null, 1));
  counts[table] = rows.length;
}

// Sign-in accounts (no passwords; they cannot be exported)
const users = [];
for (let page = 1; ; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw new Error(`accounts: ${error.message}`);
  users.push(...data.users.map((u) => ({ id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at })));
  if (data.users.length < 1000) break;
}
await writeFile(join(dir, "accounts.json"), JSON.stringify(users, null, 1));

// Ticket photos, keeping their storage paths
let photos = 0;
for (const m of JSON.parse(await readFile(join(dir, "tables", "ticket_media.json"), "utf8"))) {
  const { data, error } = await db.storage.from("ticket-media").download(m.storage_path);
  if (error) { console.warn(`photo skipped: ${m.storage_path} (${error.message})`); continue; }
  const file = join(dir, "photos", ...m.storage_path.split("/"));
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(await data.arrayBuffer()));
  photos++;
}

await writeFile(join(dir, "summary.json"), JSON.stringify({ at: new Date().toISOString(), counts, accounts: users.length, photos }, null, 1));

// Rotation
const old = (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(e.name))
  .map((e) => e.name).sort().slice(0, -KEEP);
for (const name of old) await rm(join(root, name), { recursive: true, force: true });

const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`Backup saved to ${dir}: ${total} rows in ${TABLES.length} tables, ${users.length} accounts, ${photos} photos.${old.length ? ` Removed ${old.length} old backup(s).` : ""}`);
