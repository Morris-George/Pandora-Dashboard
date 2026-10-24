// Runs tickets through diagnosis, warranty override (SoD-1), quotation, repair and QC.
// Usage: node --env-file=.env.local scripts/test-diagnosis.mjs
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
const [assoc, manager, hq, tech, sup] = await Promise.all(["associate", "manager", "hq", "technician", "supervisor"].map(as));
const { data: techProfile } = await service.from("profiles").select("id").eq("email", creds.technician.email).single();
const status = async (id) => (await service.from("tickets").select("status, warranty_final, quote_total").eq("id", id).single()).data;

// Two tickets brought to HQ: A has no invoice (branch says out of warranty), B is pending assessment
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const { data: cust } = await assoc.from("customers").insert({ full_name: "Diagnosis Test", mobile: "012" + String(Date.now()).slice(-8) }).select().single();
const make = async (extra) => {
  const { data: tk, error } = await assoc.from("tickets").insert({ customer_id: cust.id, branch_id: B.CS, item_name: "Diag item", fault_category: "Broken clasp", ...extra }).select().single();
  if (error) throw error;
  for (const n of [1, 2]) {
    const path = `${tk.id}/intake-${n}.png`;
    await assoc.storage.from("ticket-media").upload(path, png, { contentType: "image/png" });
    await assoc.from("ticket_media").insert({ ticket_id: tk.id, stage: "intake", storage_path: path });
  }
  await assoc.rpc("transition_ticket", { p_ticket: tk.id, p_to: "received_at_branch" });
  return tk;
};
const A = await make({ no_invoice: true, warranty_provisional: "out_of_warranty" });
const Bt = await make({});
const { data: ob } = await assoc.rpc("create_outbound_batch", { p_branch: B.CS, p_seal: "SEAL-D", p_tickets: [A.id, Bt.id] });
await manager.rpc("approve_batch", { p_batch: ob.id });
await hq.rpc("receive_batch", { p_batch: ob.id, p_scanned: [A.ticket_no, Bt.ticket_no] });
check("both tickets at HQ", (await status(A.id)).status === "received_at_hq" && (await status(Bt.id)).status === "received_at_hq");

const { error: techAssign } = await tech.rpc("start_diagnosis", { p_ticket: A.id, p_technician: techProfile.id });
check("technician cannot assign", !!techAssign);
const { error: badTech } = await hq.rpc("start_diagnosis", { p_ticket: A.id, p_technician: (await service.from("profiles").select("id").eq("email", creds.cs.email).single()).data.id });
check("cannot assign a non-technician", !!badTech);
for (const t of [A, Bt]) {
  const { error } = await hq.rpc("start_diagnosis", { p_ticket: t.id, p_technician: techProfile.id });
  check(`HQ assigns technician to ${t.ticket_no}`, !error, error?.message);
}

const { error: directDiag } = await tech.from("diagnoses").insert({ ticket_id: A.id, fault_found: "x", technician: techProfile.id, override_approved_by: techProfile.id });
check("direct diagnosis writes are blocked", !!directDiag);

const args = (ticket, warranty, extra = {}) => ({ p_ticket: ticket, p_fault: "Clasp spring broken", p_root_cause: "Manufacturing", p_warranty: warranty,
  p_exclusion: "", p_override_reason: "", p_quote: [], ...extra });
const { error: noReason } = await tech.rpc("submit_diagnosis", args(A.id, "under_warranty"));
check("override without reason is rejected", !!noReason);
const { data: o1, error: o1e } = await tech.rpc("submit_diagnosis", args(A.id, "under_warranty", { p_override_reason: "Manufacturing defect, receipt shown in app" }));
check("override goes to supervisor", o1 === "override_pending", o1e?.message);
check("ticket waits under diagnosis", (await status(A.id)).status === "under_diagnosis");
const { error: selfApprove } = await tech.rpc("decide_override", { p_ticket: A.id, p_approve: true });
check("technician cannot approve own override", !!selfApprove);
const { error: apErr } = await sup.rpc("decide_override", { p_ticket: A.id, p_approve: true });
check("supervisor approves override", !apErr, apErr?.message);
const sA = await status(A.id);
check("A under warranty and in repair", sA.status === "in_repair" && sA.warranty_final === "under_warranty");

const { error: noQuote } = await tech.rpc("submit_diagnosis", args(Bt.id, "out_of_warranty"));
check("out of warranty without quote is rejected", !!noQuote);
const { data: o2, error: o2e } = await tech.rpc("submit_diagnosis", args(Bt.id, "out_of_warranty", { p_exclusion: "misuse", p_quote: [{ desc: "Labour", qty: 1, price: 100 }] }));
check("out of warranty quote applied", o2 === "applied", o2e?.message);
const sB = await status(Bt.id);
check("B awaiting customer approval, total incl. 14% VAT", sB.status === "awaiting_customer_approval" && Number(sB.quote_total) === 114, JSON.stringify(sB));

const { error: hqDone } = await hq.rpc("complete_repair", { p_ticket: A.id, p_parts: [] });
check("non-assigned user cannot complete repair", !!hqDone);
const { error: cr } = await tech.rpc("complete_repair", { p_ticket: A.id, p_parts: [{ code: "CLASP-925", qty: 1 }] });
check("technician completes repair with parts", !cr, cr?.message);
const { count } = await service.from("parts_consumption").select("*", { count: "exact", head: true }).eq("ticket_id", A.id);
check("part recorded", count === 1);
const { error: techQc } = await tech.rpc("transition_ticket", { p_ticket: A.id, p_to: "ready_to_return" });
check("technician cannot pass own QC", !!techQc);
const { error: qc } = await sup.rpc("transition_ticket", { p_ticket: A.id, p_to: "ready_to_return" });
check("supervisor passes QC", !qc && (await status(A.id)).status === "ready_to_return", qc?.message);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
