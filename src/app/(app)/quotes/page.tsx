import { requireRole } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { QuotesPanel, type QuoteJob } from "./quotes-panel";

export const metadata = { title: "Pandora Maintenance" };

export default async function QuotesPage() {
  await requireRole("cs");
  const { locale } = await getI18n();
  const supabase = await createClient();

  const { data: tickets } = await supabase.from("tickets")
    .select("id, ticket_no, item_name, item_code, status, customer_id, updated_at, branches(name)")
    .in("status", ["awaiting_customer_approval", "quote_rejected"]).order("updated_at");
  const ids = (tickets ?? []).map((t) => t.id);
  const custIds = [...new Set((tickets ?? []).map((t) => t.customer_id))];

  const [{ data: quotes }, { data: diags }, { data: customers }] = await Promise.all([
    ids.length ? supabase.from("quotations").select("ticket_id, lines, subtotal, tax, total, status, sent_at").in("ticket_id", ids).order("sent_at", { ascending: false }) : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("diagnoses").select("ticket_id, fault_found, root_cause, exclusion_code").in("ticket_id", ids) : Promise.resolve({ data: [] }),
    // CS is a contact role, so it reads full customer details (BRD 4.1)
    custIds.length ? supabase.from("customers").select("id, full_name, mobile, email").in("id", custIds) : Promise.resolve({ data: [] }),
  ]);
  const quoteBy = new Map<string, NonNullable<typeof quotes>[number]>();
  (quotes ?? []).forEach((q) => { if (!quoteBy.has(q.ticket_id)) quoteBy.set(q.ticket_id, q); });
  const diagBy = new Map((diags ?? []).map((x) => [x.ticket_id, x]));
  const custBy = new Map((customers ?? []).map((c) => [c.id, c]));

  const jobs: QuoteJob[] = (tickets ?? []).map((t) => {
    const q = quoteBy.get(t.id);
    const dg = diagBy.get(t.id);
    const c = custBy.get(t.customer_id);
    return {
      id: t.id, ticketNo: t.ticket_no, itemName: t.item_name, itemCode: t.item_code, status: t.status,
      branchName: (t.branches as unknown as { name: string } | null)?.name ?? "—",
      customer: c?.full_name ?? "—", mobile: c?.mobile ?? "", email: c?.email ?? "",
      fault: dg?.fault_found ?? "", cause: dg?.root_cause ?? "", exclusion: dg?.exclusion_code ?? "",
      lines: (q?.lines as { desc: string; qty: number; price: number }[]) ?? [],
      subtotal: Number(q?.subtotal ?? 0), tax: Number(q?.tax ?? 0), total: Number(q?.total ?? 0),
      sentAt: q?.sent_at ?? t.updated_at,
    };
  });

  return <QuotesPanel locale={locale} jobs={jobs} />;
}
