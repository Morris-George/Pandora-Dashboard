// Runs a full outbound + return cycle through the dispatch RPCs and checks SoD and incidents.
// Usage: node --env-file=.env.local scripts/test-dispatch.mjs
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
const [assoc, manager, assoc2, hq, tech, sup] = await Promise.all(
  ["associate", "manager", "associate2", "hq", "technician", "supervisor"].map(as));

// Two received tickets at CS
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const { data: cust } = await assoc.from("customers").insert({ full_name: "Dispatch Test", mobile: "011" + String(Date.now()).slice(-8) }).select().single();
const tickets = [];
for (const name of ["Dispatch ring", "Dispatch charm"]) {
  const { data: tk } = await assoc.from("tickets").insert({ customer_id: cust.id, branch_id: B.CS, item_name: name, fault_category: "Sizing" }).select().single();
  for (const n of [1, 2]) {
    const path = `${tk.id}/intake-${n}.png`;
    await assoc.storage.from("ticket-media").upload(path, png, { contentType: "image/png" });
    await assoc.from("ticket_media").insert({ ticket_id: tk.id, stage: "intake", storage_path: path });
  }
  await assoc.rpc("transition_ticket", { p_ticket: tk.id, p_to: "received_at_branch" });
  tickets.push(tk);
}
const ids = tickets.map((t) => t.id);
const status = async (id) => (await service.from("tickets").select("status, current_location").eq("id", id).single()).data;

const { error: noSeal } = await assoc.rpc("create_outbound_batch", { p_branch: B.CS, p_seal: " ", p_tickets: ids });
check("batch without seal is rejected", !!noSeal);
const { error: otherBr } = await assoc2.rpc("create_outbound_batch", { p_branch: B.CS, p_seal: "S1", p_tickets: ids });
check("other-branch associate cannot pack CS items", !!otherBr);

const { data: ob, error: obErr } = await assoc.rpc("create_outbound_batch", { p_branch: B.CS, p_seal: "SEAL-T1", p_tickets: ids });
check("associate packs outbound batch", !obErr && ob?.status === "awaiting_approval", obErr?.message);
check("tickets now awaiting dispatch", (await status(ids[0])).status === "awaiting_dispatch");

const { error: assocApprove } = await assoc.rpc("approve_batch", { p_batch: ob.id });
check("associate cannot approve", !!assocApprove);
const { error: hqEarly } = await hq.rpc("receive_batch", { p_batch: ob.id, p_scanned: [] });
check("HQ cannot receive before approval", !!hqEarly);
const { error: apErr } = await manager.rpc("approve_batch", { p_batch: ob.id });
check("manager approves", !apErr, apErr?.message);
const s1 = await status(ids[0]);
check("tickets in transit to HQ", s1.status === "in_transit_to_hq" && s1.current_location === "in_transit");

const { error: techRecv } = await tech.rpc("receive_batch", { p_batch: ob.id, p_scanned: [tickets[0].ticket_no] });
check("technician cannot receive", !!techRecv);
const { data: rb1, error: rcErr } = await hq.rpc("receive_batch", { p_batch: ob.id, p_scanned: [tickets[0].ticket_no.toLowerCase()] });
check("HQ receives with one item scanned", !rcErr, rcErr?.message);
check("missing item → batch incident", rb1?.status === "incident");
check("scanned item received at HQ", (await status(ids[0])).status === "received_at_hq");
check("unscanned item still in transit", (await status(ids[1])).status === "in_transit_to_hq");

// Workshop steps to get item 1 ready to return
await hq.rpc("transition_ticket", { p_ticket: ids[0], p_to: "under_diagnosis" });
await tech.rpc("transition_ticket", { p_ticket: ids[0], p_to: "in_repair" });
await tech.rpc("transition_ticket", { p_ticket: ids[0], p_to: "quality_check" });
await sup.rpc("transition_ticket", { p_ticket: ids[0], p_to: "ready_to_return" });
check("item ready to return", (await status(ids[0])).status === "ready_to_return");

const { error: wrongDest } = await sup.rpc("create_return_batch", { p_branch: B.MOE, p_seal: "R1", p_tickets: [ids[0]] });
check("return to the wrong branch is rejected", !!wrongDest);
const { data: ret, error: retErr } = await sup.rpc("create_return_batch", { p_branch: B.CS, p_seal: "SEAL-R1", p_tickets: [ids[0]] });
check("supervisor creates return batch", !retErr && ret?.status === "in_transit", retErr?.message);

const { error: supRecv } = await sup.rpc("receive_batch", { p_batch: ret.id, p_scanned: [tickets[0].ticket_no] });
check("supervisor cannot receive own return", !!supRecv);
const { error: a2Recv } = await assoc2.rpc("receive_batch", { p_batch: ret.id, p_scanned: [tickets[0].ticket_no] });
check("other-branch associate cannot receive", !!a2Recv);
const { data: rr, error: rrErr } = await assoc.rpc("receive_batch", { p_batch: ret.id, p_scanned: [tickets[0].ticket_no] });
check("branch receives return batch", !rrErr && rr?.status === "received", rrErr?.message);
const s2 = await status(ids[0]);
check("item ready for pickup at branch", s2.status === "ready_for_pickup" && s2.current_location === "branch");

const { count } = await service.from("location_movements").select("*", { count: "exact", head: true }).eq("ticket_id", ids[0]);
check("location ledger has 4 moves", count === 4, String(count));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
