import Link from "next/link";
import { requireSession, type AppRole } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { loadSla, overdueDays } from "@/lib/sla";
import { createClient } from "@/lib/supabase/server";

// "My work": what is waiting for each role, with overdue counts (SLA)
type Queue = { key: string; statuses: string[]; href: string; roles: AppRole[] };
const QUEUES: Queue[] = [
  { key: "toSend", statuses: ["received_at_branch"], href: "/dispatch", roles: ["associate", "manager"] },
  { key: "toApprove", statuses: ["awaiting_dispatch"], href: "/dispatch", roles: ["manager"] },
  { key: "toPickup", statuses: ["ready_for_pickup", "uncollected"], href: "/pickup", roles: ["associate", "manager"] },
  { key: "inTransit", statuses: ["in_transit_to_hq", "in_transit_to_branch"], href: "/dispatch", roles: ["courier", "hq", "associate", "manager", "ops"] },
  { key: "toDiagnose", statuses: ["received_at_hq", "under_diagnosis"], href: "/diagnosis", roles: ["hq", "technician", "supervisor"] },
  { key: "inRepair", statuses: ["in_repair", "awaiting_parts", "quality_check"], href: "/diagnosis", roles: ["technician", "supervisor"] },
  { key: "toReturn", statuses: ["ready_to_return", "quote_rejected", "unrepairable"], href: "/dispatch", roles: ["supervisor", "cs"] },
  { key: "quotes", statuses: ["awaiting_customer_approval"], href: "/quotes", roles: ["cs", "supervisor"] },
  { key: "lost", statuses: ["lost_in_transit"], href: "/tickets?status=lost_in_transit", roles: ["ops"] },
];
const OPEN = [...new Set(QUEUES.flatMap((q) => q.statuses))];

export default async function Home({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const me = await requireSession();
  const { t: d } = await getI18n();
  const t = d.home;
  const { denied } = await searchParams;
  const supabase = await createClient();

  const queues = QUEUES.filter((q) => me.fullAccess || q.roles.includes(me.role));
  const [{ data: open }, sla] = await Promise.all([
    supabase.from("tickets").select("status, status_since").in("status", OPEN).limit(5000), // RLS: own stores only
    loadSla(supabase),
  ]);
  const now = Date.now();
  const cards = queues.map((q) => {
    const rows = (open ?? []).filter((r) => q.statuses.includes(r.status));
    return { ...q, count: rows.length, late: rows.filter((r) => overdueDays(sla, r.status, r.status_since, now) > 0).length };
  });
  cards.sort((a, b) => b.late - a.late || b.count - a.count);
  const lateTotal = (open ?? []).filter((r) => overdueDays(sla, r.status, r.status_since, now) > 0).length;

  return (
    <div className="flex flex-col gap-4">
      {denied && <p role="alert" className="rounded-xl bg-amber-50 border border-amber-200 text-amber-900 p-4 text-sm">{t.denied(d.roles[me.role])}</p>}
      <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold">{t.welcome(me.fullName)}</h1>
          <Link href="/tickets?overdue=1" className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${lateTotal ? "bg-red-50 text-red-800 border border-red-200" : "bg-emerald-50 text-emerald-900 border border-emerald-200"}`}>
            {lateTotal ? t.lateTotal(lateTotal) : t.allOnTime}
          </Link>
        </div>
        {!cards.length ? <p className="text-stone-600">{t.nothing}</p> : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {cards.map((c) => (
              <Link key={c.key} href={c.href} className={`rounded-xl border p-4 flex flex-col gap-1 hover:shadow-md hover:-translate-y-0.5 transition ${c.late ? "border-red-300 bg-red-50/40" : c.count ? "border-stone-200" : "border-stone-100 opacity-60"}`}>
                <span className="kpi-label">{t.queues[c.key]}</span>
                <span className="text-4xl font-extrabold">{c.count}</span>
                <span className={`text-xs font-semibold ${c.late ? "text-red-800" : "text-stone-500"}`}>{c.late ? t.late(c.late) : t.onTime}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
