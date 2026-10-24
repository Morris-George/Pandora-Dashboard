import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Pandora Maintenance" };

// Main path a ticket follows, for the progress bar
const STAGES = [
  ["received_at_branch", "awaiting_dispatch"],
  ["in_transit_to_hq"],
  ["received_at_hq", "under_diagnosis"],
  ["awaiting_customer_approval"],
  ["in_repair", "awaiting_parts", "quality_check"],
  ["ready_to_return", "in_transit_to_branch"],
  ["ready_for_pickup", "uncollected"],
  ["collected", "closed"],
];

type Event = { at: string; kind: "status" | "move" | "diag" | "quote" | "created"; title: string; detail?: string; by?: string };

export default async function TrackingPage({ searchParams }: { searchParams: Promise<{ q?: string; id?: string; name?: string; mobile?: string }> }) {
  await requireRole("associate", "manager", "courier", "hq", "technician", "supervisor", "cs", "finance", "ops", "admin");
  const { t: d, locale } = await getI18n();
  const t = d.tracking;
  const { q = "", id, name = "", mobile = "" } = await searchParams;
  const supabase = await createClient();
  const fmt = (s: string) => new Date(s).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short" });

  // Find the ticket (RLS limits the search to the user's scope)
  const term = q.trim().replace(/[%,()]/g, "");
  const nameTerm = name.trim().replace(/[%,()]/g, "");
  const mobTerm = mobile.replace(/\D/g, "").slice(-9);
  type Match = { id: string; ticket_no: string; item_name: string; status: string; customers?: { full_name: string; mobile: string } | null };
  let matches: Match[] = [];
  if (id) {
    const { data } = await supabase.from("tickets").select("id, ticket_no, item_name, status").eq("id", id).limit(1);
    matches = data ?? [];
  } else if (term || nameTerm || mobTerm) {
    // Ticket no. / SKU / barcode, customer name and mobile can be combined
    let qb = supabase.from("tickets").select("id, ticket_no, item_name, status, customers!inner(full_name, mobile)").neq("status", "draft");
    if (term) qb = qb.or(`ticket_no.ilike.%${term}%,item_code.ilike.%${term}%,item_barcode.ilike.%${term}%`);
    if (nameTerm) qb = qb.ilike("customers.full_name", `%${nameTerm}%`);
    if (mobTerm) qb = qb.ilike("customers.mobile", `%${mobTerm}%`);
    const { data } = await qb.order("created_at", { ascending: false }).limit(30);
    matches = (data ?? []) as unknown as Match[];
  }
  const exact = matches.length === 1 ? matches[0] : term ? matches.find((m) => m.ticket_no.toUpperCase() === term.toUpperCase()) : undefined;

  let view: React.ReactNode = null;
  if (exact) {
    const [{ data: tk }, { data: hist }, { data: moves }, { data: diag }, { data: quotes }] = await Promise.all([
      supabase.from("tickets").select("id, ticket_no, item_name, item_code, status, current_location, created_at, created_by, warranty_provisional, warranty_final, quote_total, assigned_technician, branches(name)").eq("id", exact.id).single(),
      supabase.from("status_history").select("from_status, to_status, user_id, role, reason, at").eq("ticket_id", exact.id).order("at"),
      supabase.from("location_movements").select("from_location, to_location, moved_by, moved_at, dispatch_batches(batch_no, seal_no)").eq("ticket_id", exact.id).order("moved_at"),
      supabase.from("diagnoses").select("fault_found, root_cause, warranty_decision, override_requested, submitted_at, technician").eq("ticket_id", exact.id).maybeSingle(),
      supabase.from("quotations").select("total, status, sent_at").eq("ticket_id", exact.id).order("sent_at"),
    ]);

    // Staff names (names only), read server-side
    const ids = [tk?.created_by, tk?.assigned_technician, diag?.technician, ...(hist ?? []).map((h) => h.user_id), ...(moves ?? []).map((m) => m.moved_by)].filter(Boolean) as string[];
    const { data: people } = ids.length ? await createAdminClient().from("profiles").select("id, full_name").in("id", [...new Set(ids)]) : { data: [] };
    const who = new Map((people ?? []).map((p) => [p.id, p.full_name]));
    const by = (uid: string | null, role?: string | null) => [uid ? who.get(uid) : null, role ? d.roles[role as keyof typeof d.roles] : null].filter(Boolean).join(" · ");
    const loc = (l: string | null) => (l ? t.locations[l] ?? l : "—");

    const events: Event[] = [
      ...(tk ? [{ at: tk.created_at, kind: "created" as const, title: t.created, by: by(tk.created_by) }] : []),
      ...(hist ?? []).map((h) => ({ at: h.at, kind: "status" as const, title: d.status[h.to_status] ?? h.to_status,
        detail: h.reason ? `${t.reason}: ${h.reason}` : undefined, by: by(h.user_id, h.role) })),
      ...(moves ?? []).map((m) => {
        const b = m.dispatch_batches as unknown as { batch_no: string; seal_no: string } | null;
        return { at: m.moved_at, kind: "move" as const, title: `${loc(m.from_location)} → ${loc(m.to_location)}`,
          detail: b ? `${t.batch} ${b.batch_no} · ${t.seal} ${b.seal_no}` : undefined, by: by(m.moved_by) };
      }),
      ...(diag?.submitted_at ? [{ at: diag.submitted_at, kind: "diag" as const, title: t.diagnosed,
        detail: [diag.fault_found, diag.warranty_decision && d.warranty[diag.warranty_decision as keyof typeof d.warranty], diag.override_requested && t.override].filter(Boolean).join(" · "),
        by: by(diag.technician) }] : []),
      ...(quotes ?? []).filter((x) => x.sent_at).map((x) => ({ at: x.sent_at as string, kind: "quote" as const,
        title: t.quote(Number(x.total).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", { minimumFractionDigits: 2 })), detail: d.reports.quote[x.status] ?? x.status })),
    ].sort((a, b) => a.at.localeCompare(b.at));

    const stageIdx = STAGES.findIndex((s) => s.includes(tk?.status ?? ""));
    const stop = ["quote_rejected", "unrepairable", "lost_in_transit", "cancelled"].includes(tk?.status ?? "");
    const ageDays = tk ? Math.floor((Date.now() - new Date(tk.created_at).getTime()) / 86_400_000) : 0;
    const DOT: Record<Event["kind"], string> = { created: "bg-stone-900", status: "bg-stone-900", move: "bg-amber-500", diag: "bg-sky-600", quote: "bg-rose-500" };

    view = tk && (
      <>
        <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold"><span dir="ltr">{tk.ticket_no}</span> · {tk.item_name}</h2>
              <p className="text-sm text-stone-600 mt-1">
                {(tk.branches as unknown as { name: string } | null)?.name} · {t.age(ageDays)}
                {tk.assigned_technician && ` · ${d.roles.technician}: ${who.get(tk.assigned_technician) ?? "—"}`}
              </p>
            </div>
            <Link href={`/tickets/${tk.id}`} className="text-sm underline">{t.openTicket}</Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Tile label={t.now} value={d.status[tk.status] ?? tk.status} tone={stop ? "bad" : undefined} />
            <Tile label={t.location} value={loc(tk.current_location)} />
            <Tile label={t.warranty} value={d.warranty[(tk.warranty_final ?? tk.warranty_provisional) as keyof typeof d.warranty]} />
            <Tile label={t.quoteTotal} value={Number(tk.quote_total) ? Number(tk.quote_total).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB") : "—"} />
          </div>
          <ol className="grid grid-cols-4 sm:grid-cols-8 gap-1" aria-label={t.progress}>
            {t.stages.map((s, i) => (
              <li key={s} className="flex flex-col gap-1">
                <span className={`h-1.5 rounded-full ${stop && i === stageIdx ? "bg-red-600" : i <= stageIdx ? "bg-stone-900" : "bg-stone-200"}`} />
                <span className={`text-[11px] leading-tight ${i === stageIdx ? "font-semibold" : "text-stone-500"}`}>{s}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t.timeline}</h2>
          <ol className="flex flex-col">
            {events.map((e, i) => (
              <li key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={`mt-1.5 w-2.5 h-2.5 rounded-full ${DOT[e.kind]}`} />
                  {i < events.length - 1 && <span className="flex-1 w-px bg-stone-200" />}
                </div>
                <div className="pb-4">
                  <div className="text-sm font-semibold">{e.title}</div>
                  {e.detail && <div className="text-sm text-stone-700">{e.detail}</div>}
                  <div className="text-xs text-stone-500">{fmt(e.at)}{e.by ? ` · ${e.by}` : ""}</div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-3">
        <h1 className="text-xl font-semibold">{t.title}</h1>
        <form className="flex flex-wrap gap-2">
          <input name="q" defaultValue={q || (!name && !mobile ? exact?.ticket_no : "") || ""} placeholder={t.search} aria-label={t.search} dir="ltr"
            className="flex-[1_1_220px] rounded-lg border border-stone-300 px-3 py-2.5 text-sm" autoFocus />
          <input name="name" defaultValue={name} placeholder={t.customerName} aria-label={t.customerName}
            className="flex-[1_1_180px] rounded-lg border border-stone-300 px-3 py-2.5 text-sm" />
          <input name="mobile" type="tel" inputMode="tel" defaultValue={mobile} placeholder={t.customerMobile} aria-label={t.customerMobile} dir="ltr"
            className="flex-[1_1_160px] rounded-lg border border-stone-300 px-3 py-2.5 text-sm" />
          <button className="rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-4 py-2.5 text-sm font-medium">{t.find}</button>
        </form>
        {(term || nameTerm || mobTerm || id) && !matches.length && <p className="text-sm text-stone-600">{t.notFound}</p>}
        {!exact && matches.length > 1 && (
          <ul className="flex flex-col">
            {matches.map((m) => (
              <li key={m.id} className="border-t border-stone-100 py-2 text-sm">
                <Link href={`/tracking?id=${m.id}`} className="font-semibold hover:underline" dir="ltr">{m.ticket_no}</Link>
                <span className="mx-2">{m.item_name}</span>
                {m.customers && <span className="me-2 text-stone-700">{m.customers.full_name} · <span dir="ltr">{m.customers.mobile}</span></span>}
                <span className="text-stone-500">{d.status[m.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {view}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return (
    <div className={`rounded-xl border p-3 ${tone === "bad" ? "border-red-300 bg-red-50" : "border-stone-200"}`}>
      <div className="text-xs text-stone-500">{label}</div>
      <div className="font-semibold mt-1">{value}</div>
    </div>
  );
}
