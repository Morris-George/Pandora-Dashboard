import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import type { Warranty } from "@/lib/warranty";

export const metadata = { title: "Pandora Maintenance" };

const STATUS_STYLE: Record<string, string> = {
  ready_for_pickup: "bg-emerald-100 text-emerald-900",
  closed: "bg-emerald-100 text-emerald-900",
  in_transit_to_hq: "bg-amber-100 text-amber-900",
  in_transit_to_branch: "bg-amber-100 text-amber-900",
  awaiting_customer_approval: "bg-rose-100 text-rose-900",
};

export default async function TicketsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  // Admin has no ticket access (SoD-4); RLS also returns nothing for admin
  await requireRole("associate", "manager", "courier", "hq", "technician", "supervisor", "cs", "finance", "ops", "admin");
  const { t: d, locale } = await getI18n();
  const t = d.list;
  const { q = "", status = "" } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("tickets")
    .select("id, ticket_no, created_at, status, item_name, item_code, warranty_provisional, customer_id, branches(name)")
    .neq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status) query = query.eq("status", status);
  const term = q.trim().replace(/[%,()]/g, "");
  if (term) query = query.or(`ticket_no.ilike.%${term}%,item_name.ilike.%${term}%,item_code.ilike.%${term}%`);
  const { data: tickets } = await query;

  // Customer names: full table for PII roles, masked function for others
  const ids = [...new Set((tickets ?? []).map((x) => x.customer_id))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: full } = await supabase.from("customers").select("id, full_name").in("id", ids);
    if (full?.length) full.forEach((c) => names.set(c.id, c.full_name));
    else {
      const { data: masked } = await supabase.rpc("customers_masked");
      (masked ?? []).forEach((c: { id: string; full_name: string }) => names.set(c.id, c.full_name));
    }
  }

  const fmt = (s: string) => new Date(s).toLocaleDateString(locale === "ar" ? "ar-EG" : "en-GB");
  const statuses = Object.keys(d.status).filter((s) => s !== "draft");

  return (
    <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4">
      <div className="flex flex-wrap justify-between items-baseline gap-2">
        <h1 className="text-xl font-semibold">{t.title}</h1>
        <span className="text-sm text-stone-600">{t.count(tickets?.length ?? 0)}</span>
      </div>

      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder={t.search} aria-label={t.search}
          className="flex-[1_1_260px] rounded-lg border border-stone-300 px-3 py-2.5 text-sm" />
        <select name="status" defaultValue={status} aria-label={t.cols.status}
          className="rounded-lg border border-stone-300 px-3 py-2.5 text-sm">
          <option value="">{t.all}</option>
          {statuses.map((s) => <option key={s} value={s}>{d.status[s]}</option>)}
        </select>
        <button className="rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-4 py-2.5 text-sm font-medium">{d.intake.lookup}</button>
      </form>

      {!tickets?.length ? (
        <p className="text-stone-600 py-6">{t.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="text-start text-xs text-stone-500">
                {Object.values(t.cols).map((c) => <th key={c} className="p-2 text-start font-medium">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {tickets.map((x) => (
                <tr key={x.id} className="border-t border-stone-100 hover:bg-stone-50">
                  <td className="p-2 font-semibold" dir="ltr"><Link href={`/tickets/${x.id}`} className="underline-offset-2 hover:underline">{x.ticket_no}</Link></td>
                  <td className="p-2">{fmt(x.created_at)}</td>
                  <td className="p-2">{names.get(x.customer_id) ?? "—"}</td>
                  <td className="p-2">{x.item_name}{x.item_code && <div className="text-xs text-stone-500" dir="ltr">{x.item_code}</div>}</td>
                  <td className="p-2">{(x.branches as unknown as { name: string } | null)?.name}</td>
                  <td className="p-2">{d.warranty[x.warranty_provisional as Warranty]}</td>
                  <td className="p-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs whitespace-nowrap ${STATUS_STYLE[x.status] ?? "bg-stone-100 text-stone-800"}`}>
                      {d.status[x.status] ?? x.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
