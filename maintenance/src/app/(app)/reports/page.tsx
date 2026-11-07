import { withBase } from "@/lib/base";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { buildReport, levelFor, type Level } from "@/lib/reports";

export const metadata = { title: "Pandora Maintenance" };

const KEYS = ["status", "transit", "pickup", "warranty", "productivity", "revenue", "audit"];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  // Admin manages access but sees no ticket data (SoD-4)
  await requireRole("associate", "manager", "courier", "hq", "technician", "supervisor", "cs", "finance", "ops", "admin");
  const { t: d, locale } = await getI18n();
  const t = d.reports;
  const supabase = await createClient();

  // Only reports the admin granted to this role (BRD 4.6)
  const levels = await Promise.all(KEYS.map(async (k) => [k, await levelFor(supabase, k)] as [string, Level]));
  const allowed = levels.filter(([, l]) => l !== "none");
  const { r } = await searchParams;
  const current = allowed.find(([k]) => k === r) ?? allowed[0];

  if (!current) {
    return (
      <section className="bg-white rounded-2xl border border-stone-200 p-6">
        <h1 className="text-xl font-semibold">{t.title}</h1>
        <p className="text-stone-600 mt-2">{t.noAccess}</p>
      </section>
    );
  }
  const [key, level] = current;
  const rep = await buildReport(key, supabase, d, locale);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t.title}</h1>
      <nav className="flex flex-wrap gap-2" aria-label={t.title}>
        {allowed.map(([k]) => (
          <Link key={k} href={`/reports?r=${k}`} aria-current={k === key ? "page" : undefined}
            className={`rounded-full px-3.5 py-1.5 text-sm border ${k === key ? "bg-[var(--accent)] text-[var(--on-accent)] border-stone-900" : "border-stone-300 bg-white hover:bg-stone-50"}`}>
            {d.admin.repNames[k]}
          </Link>
        ))}
      </nav>

      <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">{d.admin.repNames[key]}</h2>
            <p className="text-sm text-stone-600 mt-1">{t.notes[key]}</p>
          </div>
          {level === "export" ? (
            <a href={withBase(`/api/reports/${key}`)} download className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-4 py-2 text-sm font-bold hover:brightness-95">
              <svg aria-hidden viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16" /></svg>
              {t.export}
            </a>
          ) : (
            <span className="flex flex-col items-end gap-1 max-w-72">
              <span aria-disabled className="inline-flex items-center gap-2 rounded-lg border border-stone-200 text-stone-400 px-4 py-2 text-sm font-bold cursor-not-allowed">{t.export}</span>
              <span className="text-xs text-stone-500 text-end">{t.exportLocked}</span>
            </span>
          )}
        </div>

        {!!rep?.summary.length && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {rep.summary.map((s, i) => (
              <div key={s.label} className={`rounded-[14px] border p-4 ${i === 0 ? "border-[var(--accent)] bg-gradient-to-b from-[var(--fill-soft)] to-white to-70%" : "border-stone-200 bg-white"}`}>
                <div className="kpi-label">{s.label}</div>
                <div className="text-[25px] font-extrabold tracking-tight mt-1 tabular-nums">{typeof s.value === "number" ? s.value.toLocaleString(locale === "ar" ? "ar-EG" : "en-GB") : s.value}</div>
              </div>
            ))}
          </div>
        )}

        {!!rep?.chart?.bars.length && (() => {
          const max = Math.max(1, ...rep.chart.bars.map((b) => b.value));
          const fmtN = (n: number) => n.toLocaleString(locale === "ar" ? "ar-EG" : "en-GB");
          return (
            <figure className="rounded-[14px] border border-stone-200 p-4 flex flex-col gap-2.5">
              <figcaption className="kpi-label">{rep.chart.title}</figcaption>
              {rep.chart.bars.map((b, i) => (
                <div key={b.label} className="grid grid-cols-[minmax(90px,200px)_1fr_auto] items-center gap-3 text-sm">
                  <span className="truncate text-stone-700" title={b.label}>{b.label}</span>
                  <span className="h-2.5 rounded-full bg-stone-300/70 overflow-hidden">
                    <span className="bar-fill block h-full rounded-full bg-[var(--accent)]" style={{ width: `${(b.value / max) * 100}%`, animationDelay: `${i * 60}ms` }} />
                  </span>
                  <span className="tabular-nums font-bold">{fmtN(b.value)}{rep.chart?.unit ?? ""}</span>
                </div>
              ))}
            </figure>
          );
        })()}

        {!rep?.rows.length ? <p className="text-stone-600 py-4">{t.empty}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-xs text-stone-500">{rep.columns.map((c) => <th key={c} className="p-2 text-start font-medium">{c}</th>)}</tr>
              </thead>
              <tbody>
                {rep.rows.map((row, i) => (
                  <tr key={i} className="border-t border-stone-100">
                    {row.map((v, j) => <td key={j} className={`p-2 ${typeof v === "number" ? "tabular-nums" : ""}`}>{v}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
