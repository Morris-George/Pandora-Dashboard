// Public tracking RPCs as an anonymous visitor: view, lookup, wrong digits, throttling, quote answer.
// Usage: node --env-file=.env.local scripts/test-track.mjs  (needs a ticket awaiting customer approval)
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(URL, KEY, { auth: { persistSession: false } });
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? "  → " + detail : ""}`); };

const { data: tk } = await service.from("tickets").select("id, ticket_no, tracking_token, customers(mobile, full_name)")
  .eq("status", "awaiting_customer_approval").order("created_at", { ascending: false }).limit(1).single();
if (!tk) { console.log("No ticket awaiting approval — run test-diagnosis.mjs first"); process.exit(1); }
const last4 = tk.customers.mobile.slice(-4);

const { data: v } = await anon.rpc("track_ticket", { p_token: tk.tracking_token });
check("anonymous visitor sees the ticket", v?.ticket_no === tk.ticket_no);
check("no full name or phone exposed", !JSON.stringify(v).includes(tk.customers.mobile) && v.first_name === tk.customers.full_name.split(" ")[0]);
check("quote shown", v?.quote?.status === "sent");
const { data: none } = await anon.rpc("track_ticket", { p_token: "0".repeat(32) });
check("unknown token returns nothing", none === null);

const { error: direct } = await anon.from("tickets").select("id").limit(1);
const { data: rows } = await anon.from("tickets").select("id").limit(1);
check("anonymous cannot read tables directly", !!direct || !rows?.length);

const { data: tok } = await anon.rpc("track_lookup", { p_ticket_no: tk.ticket_no.toLowerCase(), p_last4: last4 });
check("lookup by ticket no + last 4 digits", tok === tk.tracking_token);
const { data: bad } = await anon.rpc("track_lookup", { p_ticket_no: tk.ticket_no, p_last4: "0000" === last4 ? "1111" : "0000" });
check("wrong digits → no token", bad === null);

const wrong = last4 === "9999" ? "8888" : "9999";
const { error: idErr } = await anon.rpc("track_respond", { p_token: tk.tracking_token, p_last4: wrong, p_approve: true, p_reason: "" });
check("quote answer with wrong digits rejected", !!idErr);
const { error: okErr } = await anon.rpc("track_respond", { p_token: tk.tracking_token, p_last4: last4, p_approve: true, p_reason: "" });
check("customer approves via link", !okErr, okErr?.message);
const { data: after } = await service.from("tickets").select("status").eq("id", tk.id).single();
const { data: q } = await service.from("quotations").select("status, responded_via").eq("ticket_id", tk.id).order("sent_at", { ascending: false }).limit(1).single();
check("ticket in repair, quote approved via link", after.status === "in_repair" && q.status === "approved" && q.responded_via === "link");
const { error: twice } = await anon.rpc("track_respond", { p_token: tk.tracking_token, p_last4: last4, p_approve: false, p_reason: "" });
check("cannot answer twice", !!twice);

// Throttle: 5 wrong lookups lock the ticket number for an hour
const key = "MT-THROTTLE-" + Date.now();
for (let i = 0; i < 5; i++) await anon.rpc("track_lookup", { p_ticket_no: key, p_last4: "0000" });
const { error: locked } = await anon.rpc("track_lookup", { p_ticket_no: key, p_last4: "0000" });
check("6th attempt is throttled", !!locked && locked.message.includes("too many"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
