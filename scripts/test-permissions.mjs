// Signs in as each test user and checks RLS, the state machine and SoD rules.
// Usage: node --env-file=.env.local scripts/test-permissions.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const creds = JSON.parse(readFileSync("supabase/test-users.local.json", "utf8"));
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function as(key) {
  const c = createClient(URL, KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email: creds[key].email, password: creds[key].password });
  if (error) throw new Error(`login ${key}: ${error.message}`);
  return c;
}
let pass = 0, fail = 0;
function check(name, ok, detail = "") {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? "  → " + detail : ""}`);
}

const { data: br } = await service.from("branches").select("id, code");
const B = Object.fromEntries(br.map((b) => [b.code, b.id]));
const mobile = "010" + String(Date.now()).slice(-8);

const assoc = await as("associate");
const { data: cust, error: ce } = await assoc.from("customers").insert({ full_name: "RLS Test", mobile }).select().single();
check("associate creates customer", !ce, ce?.message);

const { data: tk, error: te } = await assoc.from("tickets")
  .insert({ customer_id: cust?.id, branch_id: B.CS, item_name: "Test bracelet", fault_category: "Broken clasp" }).select().single();
check("associate creates ticket in own branch", !te, te?.message);

const { error: other } = await assoc.from("tickets")
  .insert({ customer_id: cust?.id, branch_id: B.CS, item_name: "x", fault_category: "Other" });
check("'Other' without comment is rejected", !!other);

const { error: wrongBr } = await assoc.from("tickets")
  .insert({ customer_id: cust?.id, branch_id: B.MOE, item_name: "x", fault_category: "Sizing" });
check("associate cannot create ticket in another branch", !!wrongBr);

const { error: direct } = await assoc.from("tickets").update({ status: "closed" }).eq("id", tk?.id);
check("direct status update is blocked", !!direct);

const { error: noPhotos } = await assoc.rpc("transition_ticket", { p_ticket: tk?.id, p_to: "received_at_branch" });
check("cannot leave draft without 2 photos", !!noPhotos);

// 1x1 PNG
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const paths = [];
for (const n of [1, 2]) {
  const path = `${tk?.id}/intake-${n}.png`;
  const { error: upErr } = await assoc.storage.from("ticket-media").upload(path, png, { contentType: "image/png" });
  check(`associate uploads photo ${n}`, !upErr, upErr?.message);
  const { error: rowErr } = await assoc.from("ticket_media").insert({ ticket_id: tk?.id, stage: "intake", storage_path: path });
  check(`associate records photo ${n}`, !rowErr, rowErr?.message);
  paths.push(path);
}
const { data: peek } = await (await as("associate2")).storage.from("ticket-media").download(paths[0]);
check("other-branch associate cannot download the photo", !peek);

const { error: t1 } = await assoc.rpc("transition_ticket", { p_ticket: tk?.id, p_to: "received_at_branch" });
check("associate: draft → received_at_branch (with photos)", !t1, t1?.message);

const { error: skip } = await assoc.rpc("transition_ticket", { p_ticket: tk?.id, p_to: "ready_for_pickup" });
check("skipping states is rejected", !!skip);

const tech = await as("technician");
const { error: t2 } = await tech.rpc("transition_ticket", { p_ticket: tk?.id, p_to: "awaiting_dispatch" });
check("technician cannot do a branch transition", !!t2);

const { data: techCust } = await tech.from("customers").select("mobile");
check("technician cannot read raw customer phone numbers", (techCust ?? []).length === 0);
const { data: masked } = await tech.rpc("customers_masked");
check("technician sees masked phone", (masked ?? []).some((m) => m.mobile_masked.includes("•")));

const assoc2 = await as("associate2");
const { data: other2 } = await assoc2.from("tickets").select("id").eq("id", tk?.id);
check("other-branch associate cannot see the ticket", (other2 ?? []).length === 0);

const adm = await as("admin");
const { data: admT } = await adm.from("tickets").select("id");
check("admin sees no tickets (SoD-4)", (admT ?? []).length === 0);
const catName = "Test category " + Date.now();
const { error: catA } = await adm.from("fault_categories").insert({ name: catName });
check("admin can add a fault category", !catA, catA?.message);
const { error: catB } = await assoc.from("fault_categories").insert({ name: catName + " x" });
check("associate cannot add a fault category", !!catB);
const { error: catSys } = await adm.from("fault_categories").update({ active: false }).eq("name", "Other");
check("'Other' cannot be removed", !!catSys);

const { data: audA } = await assoc.from("audit_log").select("id").limit(1);
check("associate cannot read audit log", (audA ?? []).length === 0);
const ops = await as("ops");
const { data: audO } = await ops.from("audit_log").select("id").limit(1);
check("ops can read audit log (report grant)", (audO ?? []).length > 0);

// cleanup test data (service role)
await service.from("fault_categories").delete().like("name", "Test category %");
if (tk?.id) {
  await service.storage.from("ticket-media").remove(paths);
  await service.from("ticket_media").delete().eq("ticket_id", tk.id);
  await service.from("status_history").delete().eq("ticket_id", tk.id);
  await service.from("tickets").delete().eq("id", tk.id);
}
if (cust?.id) await service.from("customers").delete().eq("id", cust.id);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
