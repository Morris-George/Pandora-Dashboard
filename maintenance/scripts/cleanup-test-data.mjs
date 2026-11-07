// Removes the automated-test accounts (…@pandora-maintenance.test) and everything their tests created:
// tickets with their history, batches, quotes, photos, and customers left without tickets.
// Usage: node --env-file=.env.local scripts/cleanup-test-data.mjs
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };

const users = must(await db.from("profiles").select("id, email").like("email", "%@pandora-maintenance.test"), "test users");
const uids = users.map((u) => u.id);
if (!uids.length) { console.log("No test accounts."); process.exit(0); }

const tickets = must(await db.from("tickets").select("id, customer_id").in("created_by", uids), "tickets");
const tids = tickets.map((t) => t.id);
const batches = must(await db.from("dispatch_batches").select("id").in("sent_by", uids), "batches").map((b) => b.id);

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

must(await db.from("role_change_requests").delete().or(`user_id.in.(${uids}),requested_by.in.(${uids}),approved_by.in.(${uids})`), "role requests");
must(await db.from("sales_persons").update({ profile_id: null }).in("profile_id", uids), "sales persons");
must(await db.from("fault_categories").update({ updated_by: null }).in("updated_by", uids), "categories");
must(await db.from("fault_categories").delete().like("name", "Test category %"), "test categories");
for (const u of users) {
  must(await db.from("user_branches").delete().eq("user_id", u.id), "user branches");
  must(await db.from("profiles").delete().eq("id", u.id), `profile ${u.email}`);
  must(await db.auth.admin.deleteUser(u.id), `auth ${u.email}`);
}
console.log(`Removed ${users.length} test accounts, ${tids.length} tickets, ${batches.length} batches, ${customers} customers.`);
