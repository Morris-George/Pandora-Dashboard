import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Dict } from "@/lib/i18n/dictionaries";

// Tickets the signed-in person may see (RLS decides the scope by role and store), for Ticket Tracking and its Excel file.
// Filters are the same as the Tracking search: ticket no. / SKU / barcode, customer name and mobile.
export type TicketRow = { id: string; ticket_no: string; created_at: string; status: string; item_name: string; item_code: string | null;
  store: string; customer: string; mobile: string };

export async function listTickets(supabase: SupabaseClient, f: { term?: string; name?: string; mobile?: string }, limit: number): Promise<TicketRow[]> {
  const join = f.name || f.mobile ? "customers!inner(full_name, mobile)" : "customers(full_name, mobile)";
  let q = supabase.from("tickets").select(`id, ticket_no, created_at, status, item_name, item_code, branches(name), ${join}`)
    .neq("status", "draft").order("created_at", { ascending: false }).limit(limit);
  if (f.term) q = q.or(`ticket_no.ilike.%${f.term}%,item_code.ilike.%${f.term}%,item_barcode.ilike.%${f.term}%`);
  if (f.name) q = q.ilike("customers.full_name", `%${f.name}%`);
  if (f.mobile) q = q.ilike("customers.mobile", `%${f.mobile}%`);
  const { data } = await q;
  return (data ?? []).map((t) => {
    const c = t.customers as unknown as { full_name: string; mobile: string } | null;
    return { id: t.id, ticket_no: t.ticket_no, created_at: t.created_at, status: t.status, item_name: t.item_name, item_code: t.item_code,
      store: (t.branches as unknown as { name: string } | null)?.name ?? "", customer: c?.full_name ?? "", mobile: c?.mobile ?? "" };
  });
}

export const ticketColumns = (d: Dict) => [d.tracking.colTicket, d.tracking.colDate, d.tracking.colStore, d.tracking.colItem, d.tracking.colSku, d.tracking.customerName, d.tracking.customerMobile, d.tracking.colStatus];
export const ticketCells = (r: TicketRow, d: Dict, locale: string) =>
  [r.ticket_no, new Date(r.created_at).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB"), r.store, r.item_name, r.item_code ?? "", r.customer, r.mobile, d.status[r.status] ?? r.status];
