// Takes a paid (approved-quote) ticket and a free one through pickup.
// Usage: node --env-file=.env.local scripts/test-pickup.mjs  (run test-diagnosis + test-quotes first)
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
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? "  → " + detail : ""}`); };
const [assoc, assoc2, tech, sup, courier] = await Promise.all(["associate", "associate2", "technician", "supervisor", "courier"].map(as));
const { data: br } = await service.from("branches").select("id, code");
const B = Object.fromEntries(br.map((b) => [b.code, b.id]));

// Paid ticket: approved quote, still in repair → finish and return it to CS branch
const { data: q } = await service.from("quotations").select("ticket_id, total, tickets!inner(status, ticket_no)").eq("status", "approved").eq("tickets.status", "in_repair").limit(1).single();
if (!q) { console.log("No approved ticket in repair — run test-diagnosis and test-quotes first"); process.exit(1); }
const paid = q.ticket_id, total = Number(q.total);
await tech.rpc("complete_repair", { p_ticket: paid, p_parts: [] });
await sup.rpc("transition_ticket", { p_ticket: paid, p_to: "ready_to_return" });
const { data: rb } = await sup.rpc("create_return_batch", { p_branch: B.CS, p_seal: "SEAL-P", p_tickets: [paid] });
await courier.rpc("courier_pickup", { p_batch: rb.id, p_seal: "SEAL-P", p_scanned: [q.tickets.ticket_no] });
await assoc.rpc("receive_batch", { p_batch: rb.id, p_scanned: [q.tickets.ticket_no] });

const { data: t1 } = await service.from("tickets").select("status, customer_id").eq("id", paid).single();
check("paid ticket ready for pickup", t1.status === "ready_for_pickup", t1.status);
const { data: c } = await service.from("customers").select("mobile").eq("id", t1.customer_id).single();
const last4 = c.mobile.slice(-4);
const { data: due } = await assoc.rpc("amount_due", { p_ticket: paid });
check("amount due equals approved quote", Number(due) === total, `${due} vs ${total}`);

// The repair invoice is issued in ERPNext; the ticket only links its number
const args = (x) => ({ p_ticket: paid, p_mobile_last4: last4, p_erp_invoice: "ACC-SINV-TEST-1", p_collected_by: "", ...x });
check("wrong last 4 digits rejected", !!(await assoc.rpc("collect_ticket", args({ p_mobile_last4: "0000" }))).error);
check("other-branch associate blocked", !!(await assoc2.rpc("collect_ticket", args({}))).error);
check("paid pickup without an ERPNext invoice rejected", !!(await assoc.rpc("collect_ticket", args({ p_erp_invoice: "" }))).error);
const { data: o1, error: e1 } = await assoc.rpc("collect_ticket", args({}));
check("paid pickup with invoice → closed", o1 === "closed", e1?.message);
const { data: t2 } = await service.from("tickets").select("status, erp_repair_invoice").eq("id", paid).single();
check("invoice number linked to the ticket", t2.erp_repair_invoice === "ACC-SINV-TEST-1" && t2.status === "closed", JSON.stringify(t2));

// Free ticket: any other CS ticket ready for pickup
const { data: free } = await service.from("tickets").select("id, customer_id").eq("status", "ready_for_pickup").eq("branch_id", B.CS).limit(1).maybeSingle();
if (free) {
  const { data: fc2 } = await service.from("customers").select("mobile").eq("id", free.customer_id).single();
  const { data: o2, error: e2 } = await assoc.rpc("collect_ticket", { p_ticket: free.id, p_mobile_last4: fc2.mobile.slice(-4), p_erp_invoice: "", p_collected_by: "Collected by: Brother" });
  check("free pickup closes immediately", o2 === "closed", e2?.message);
}
console.log(`
${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
