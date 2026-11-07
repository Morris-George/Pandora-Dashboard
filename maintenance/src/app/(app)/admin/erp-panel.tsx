"use client";

import { useState, useTransition } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { includeInSync, syncNow } from "./actions";

type Run = { at: string; trigger: string; ok: boolean | null; summary: Record<string, number | string[]> | null } | null;

export function ErpPanel({ locale, configured, lastRun, excluded }: {
  locale: Locale; configured: boolean; lastRun: Run; excluded: { email: string; reason: string | null }[];
}) {
  const t = dictionaries[locale].admin.erp;
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fmt = (s: string) => new Date(s).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
  const counts = (sm: Record<string, number | string[]> | null) =>
    sm ? t.counts(Number(sm.usersCreated ?? 0), Number(sm.usersUpdated ?? 0), Number(sm.usersDeactivated ?? 0), Number(sm.usersReactivated ?? 0), Number(sm.branchesCreated ?? 0) + Number(sm.branchesUpdated ?? 0))
      + " · " + t.spCounts(Number(sm.salesPersonsNew ?? 0), Number(sm.salesPersonsUnallocated ?? 0)) : "";

  return (
    <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t.title}</h2>
          <p className="text-sm text-stone-600 mt-1 max-w-2xl">{t.note}</p>
        </div>
        <button disabled={busy || !configured} aria-busy={busy}
          onClick={() => start(async () => {
            setMsg(null);
            const r = await syncNow();
            setMsg(r.error ? { ok: false, text: t.failed + (r.summary?.errors?.[0] ? ` — ${r.summary.errors[0]}` : "") } : { ok: true, text: counts(r.summary as never) });
          })}
          className="rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-4 py-2 text-sm font-bold disabled:opacity-40">
          {busy ? t.syncing : t.syncNow}
        </button>
      </div>
      {!configured && <p className="text-sm text-amber-800">{t.notConfigured}</p>}
      {msg && <p role="status" className={`rounded-lg text-sm p-3 ${msg.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}>{msg.text}</p>}
      {lastRun && (
        <p className="text-sm text-stone-600">
          {t.lastRun(fmt(lastRun.at), t.triggers[lastRun.trigger] ?? lastRun.trigger)} · {lastRun.ok ? counts(lastRun.summary) : t.failed}
        </p>
      )}
      <div>
        <h3 className="font-semibold text-sm">{t.excludedTitle} <span className="font-normal text-stone-500">({excluded.length})</span></h3>
        <p className="text-xs text-stone-500 mt-0.5">{t.excludedNote}</p>
        {excluded.map((e) => (
          <div key={e.email} className="flex flex-wrap items-center gap-3 border-t border-stone-100 py-2 text-sm">
            <span dir="ltr" className="flex-1">{e.email}</span>
            {e.reason && <span className="text-xs text-stone-500">{e.reason}</span>}
            <button disabled={busy} className="rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs"
              onClick={() => start(async () => { await includeInSync(e.email); })}>{t.include}</button>
          </div>
        ))}
      </div>
    </section>
  );
}
