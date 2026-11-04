import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendStaffEmail } from "@/lib/email";

// Internal alerts to the addresses in Admin → Lost item alerts (app_settings 'alerts').
// Sent when a bag arrives short and when an item is confirmed lost. Failures never block the action.

const SITE = process.env.APP_BASE_URL || process.env.SITE_URL || "https://pandora-maintenance.vercel.app";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

async function recipients(): Promise<string[]> {
  const { data } = await createAdminClient().from("app_settings").select("value").eq("key", "alerts").maybeSingle();
  const raw = (data?.value as { lostEmails?: string } | null)?.lostEmails ?? "";
  return raw.split(/[,;\s]+/).map((e) => e.trim()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
}

function body(title: string, rows: [string, string][], items: string[]) {
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#2A1018">
<h2 style="color:#b91c1c">${esc(title)}</h2>
<table style="border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#6b5a5e">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`).join("")}</table>
${items.length ? `<p style="margin-top:12px">Items / القطع:</p><ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}
<p><a href="${SITE}/dispatch">${esc(SITE)}/dispatch</a></p></body></html>`;
}

// A bag was received with items missing (status 'incident')
export async function alertShortBatch(batchId: string) {
  try {
    const to = await recipients();
    if (!to.length) return;
    const db = createAdminClient();
    const { data: b } = await db.from("dispatch_batches")
      .select("batch_no, status, direction, seal_no, branches(name), batch_items(scanned_in, tickets(ticket_no, item_name))").eq("id", batchId).maybeSingle();
    if (!b || b.status !== "incident") return;
    const items = (b.batch_items as unknown as { scanned_in: boolean; tickets: { ticket_no: string; item_name: string } | null }[]);
    const missing = items.filter((i) => !i.scanned_in).map((i) => `${i.tickets?.ticket_no} — ${i.tickets?.item_name}`);
    const store = (b.branches as unknown as { name: string } | null)?.name ?? "—";
    await sendStaffEmail(to, `⚠ Bag ${b.batch_no} arrived short (${missing.length} missing) · شحنة ناقصة`,
      body(`Bag arrived short · الشحنة وصلت ناقصة`, [["Bag", b.batch_no], ["Store", store], ["Seal", b.seal_no], ["Received", `${items.length - missing.length} / ${items.length}`]], missing));
  } catch { /* alert only */ }
}

// Ops confirmed a ticket lost (ticket → lost_in_transit)
export async function alertItemLost(ticketId: string, reason: string) {
  try {
    const to = await recipients();
    if (!to.length) return;
    const { data: t } = await createAdminClient().from("tickets").select("ticket_no, item_name, branches(name)").eq("id", ticketId).maybeSingle();
    if (!t) return;
    const store = (t.branches as unknown as { name: string } | null)?.name ?? "—";
    await sendStaffEmail(to, `⛔ Item lost: ${t.ticket_no} · قطعة مفقودة`,
      body(`Item confirmed lost · تم تأكيد فقد قطعة`, [["Ticket", t.ticket_no], ["Item", t.item_name], ["Store", store], ["Reason", reason]], []));
  } catch { /* alert only */ }
}
