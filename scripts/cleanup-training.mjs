// Removes all training data before go-live: tickets of the training store "فرع تدريب" with their history,
// batches, quotes and photos, customers left without tickets, and (with --accounts) the training accounts and the store.
// Usage: node --env-file=.env.local scripts/cleanup-training.mjs [--accounts]
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };

const withAccounts = process.argv.includes("--accounts");
const { data: trn } = await db.from("branches").select("id").eq("code", "TRN").eq("is_training", true).maybeSingle();
if (!trn) { console.log("No training store."); process.exit(0); }
const users = must(await db.from("profiles").select("id, email").eq("is_training", true), "training users");
const uids = users.map((u) => u.id);

const tickets = must(await db.from("tickets").select("id, customer_id").eq("branch_id", trn.id), "tickets");
const tids = tickets.map((t) => t.id);
const batches = must(await db.from("dispatch_batches").select("id").eq("branch_id", trn.id), "batches").map((b) => b.id);

if (tids.length) {
  const media = must(await db.from("ticket_media").select("storage_path").in("ticket_id", tids), "media");
  if (media.length) must(await db.storage.from("ticket-media").remove(media.map((m) => m.storage_path)), "photos");
  for (const table of ["batch_items", "location_movements", "status_history", "payments", "parts_consumption", "integration_outbox", "email_outbox", "notification_log", "quotations", "diagnoses", "ticket_media"]) {
    must(await db.from(table).delete().in("ticket_id", tids), table);
  }
}
if (batches.length) {
  must(await db.from("batch_items").delete().in("batch_id", batches), "batch items");
  must(await db.from("location_movements").delete().in("batch_id", batches), "movements");
  must(await db.from("dispatch_batches").delete().in("id", batches), "batches");
}
if (tids.length) must(await db.from("tickets").delete().in("id", tids), "tickets");

// Customers that no longer have any ticket
const custIds = [...new Set(tickets.map((t) => t.customer_id))];
let customers = 0;
for (const c of custIds) {
  const { count } = await db.from("tickets").select("id", { count: "exact", head: true }).eq("customer_id", c);
  if (!count) { must(await db.from("customers").delete().eq("id", c), "customer"); customers++; }
}

if (!withAccounts) {
  console.log(`Removed ${tids.length} training tickets, ${batches.length} batches, ${customers} customers. Training accounts kept.`);
  process.exit(0);
}
if (uids.length) {
  must(await db.from("role_change_requests").delete().or(`user_id.in.(${uids}),requested_by.in.(${uids}),approved_by.in.(${uids})`), "role requests");
  must(await db.from("item_cost_links").update({ updated_by: null }).in("updated_by", uids), "cost links");
}
for (const u of users) {
  must(await db.from("user_branches").delete().eq("user_id", u.id), "user branches");
  must(await db.from("profiles").delete().eq("id", u.id), `profile ${u.email}`);
  must(await db.auth.admin.deleteUser(u.id), `auth ${u.email}`);
}
must(await db.from("user_branches").delete().eq("branch_id", trn.id), "store links");
must(await db.from("branches").delete().eq("id", trn.id), "training store");
console.log(`Removed ${users.length} training accounts, the training store, ${tids.length} tickets, ${batches.length} batches, ${customers} customers.`);
