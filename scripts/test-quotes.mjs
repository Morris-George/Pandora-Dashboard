// Records customer answers on quotes and checks the CS-only and call-reference rules.
// Usage: node --env-file=.env.local scripts/test-quotes.mjs  (needs a ticket awaiting customer approval)
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

const { data: tk } = await service.from("tickets").select("id, ticket_no").eq("status", "awaiting_customer_approval").limit(1).single();
if (!tk) { console.log("No ticket awaiting approval — run test-diagnosis.mjs first"); process.exit(1); }
const [cs, tech] = await Promise.all(["cs", "technician"].map(as));
const ans = (extra) => ({ p_ticket: tk.id, p_approve: true, p_via: "phone_agent", p_call_ref: "", p_reason: "", ...extra });

const { error: e1 } = await tech.rpc("respond_quote", ans({ p_call_ref: "CALL-1" }));
check("technician cannot record the answer", !!e1);
const { error: e2 } = await cs.rpc("respond_quote", ans({}));
check("phone answer needs a call reference", !!e2);
const { error: e3 } = await cs.rpc("respond_quote", ans({ p_approve: false, p_call_ref: "CALL-1" }));
check("rejecting needs a reason", !!e3);
const { error: e4 } = await cs.from("quotations").update({ status: "approved" }).eq("ticket_id", tk.id);
const { data: q0 } = await service.from("quotations").select("status").eq("ticket_id", tk.id).single();
check("direct quote edits are blocked", !!e4 || q0.status === "sent");
const { error: ok } = await cs.rpc("respond_quote", ans({ p_call_ref: "CALL-1" }));
check(`CS records approval for ${tk.ticket_no}`, !ok, ok?.message);
const { data: q } = await service.from("quotations").select("status, responded_via, call_reference").eq("ticket_id", tk.id).single();
const { data: t2 } = await service.from("tickets").select("status").eq("id", tk.id).single();
check("quote approved with call reference", q.status === "approved" && q.call_reference === "CALL-1");
check("ticket back in repair", t2.status === "in_repair");
const { error: again } = await cs.rpc("respond_quote", ans({ p_call_ref: "CALL-2" }));
check("cannot answer twice", !!again);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
