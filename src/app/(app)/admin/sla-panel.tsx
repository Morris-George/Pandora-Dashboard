"use client";

import { useState, useTransition } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { toast } from "@/components/toast";
import { saveSla } from "./actions";

const input = "rounded-lg border border-stone-300 px-3 py-2 text-sm font-normal focus:outline-2 focus:outline-stone-900";

// Admin → SLA: target days per stage; tickets past the target show as late
export function SlaPanel({ locale, rules }: { locale: Locale; rules: { status: string; days: number }[] }) {
  const d = dictionaries[locale];
  const t = d.admin.sla;
  const [busy, start] = useTransition();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const changed = rules.filter((r) => draft[r.status] !== undefined && Number(draft[r.status]) !== r.days);
  const invalid = changed.some((r) => !(Number(draft[r.status]) > 0 && Number(draft[r.status]) <= 365));

  const save = () => start(async () => {
    setError("");
    const r = await saveSla(changed.map((x) => ({ status: x.status, days: Number(draft[x.status]) }))).catch(() => ({ error: "failed" }));
    if (r.error) { setError(t.failed); return; }
    setDraft({});
    toast();
  });

  return (
    <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t.title}</h2>
        <p className="text-sm text-stone-600 mt-1 max-w-2xl">{t.note}</p>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-6 gap-y-2">
        {rules.map((r) => {
          const v = draft[r.status] ?? String(r.days);
          const dirty = draft[r.status] !== undefined && Number(v) !== r.days;
          return (
            <label key={r.status} className="flex items-center justify-between gap-3 border-t border-stone-100 pt-2 text-sm">
              <span>{d.status[r.status as keyof typeof d.status] ?? r.status}</span>
              <span className="flex items-center gap-2">
                <input value={v} onChange={(e) => setDraft({ ...draft, [r.status]: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" dir="ltr"
                  className={`${input} w-20 text-center ${dirty ? "ring-2 ring-amber-400" : ""}`} />
                <span className="text-xs text-stone-500 w-8">{t.days}</span>
              </span>
            </label>
          );
        })}
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 text-red-800 text-sm p-3">{error}</p>}
      <div className="flex flex-wrap items-center gap-3 border-t border-stone-200 pt-4">
        <button disabled={busy || !changed.length || invalid} onClick={save}
          className="rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-5 py-2.5 text-sm font-bold disabled:opacity-40">{t.save}</button>
        <button disabled={busy || !changed.length} onClick={() => setDraft({})} className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm disabled:opacity-40">{t.discard}</button>
        <span className="text-sm text-stone-600">{invalid ? t.invalid : changed.length ? t.unsaved(changed.length) : ""}</span>
      </div>
    </section>
  );
}
