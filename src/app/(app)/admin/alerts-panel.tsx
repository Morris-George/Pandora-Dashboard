"use client";

import { useState, useTransition } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { saveAlerts } from "./actions";

// Who is emailed when a bag arrives short or an item is confirmed lost
export function AlertsPanel({ locale, initial }: { locale: Locale; initial: string }) {
  const t = dictionaries[locale].admin.alerts;
  const [v, setV] = useState(initial);
  const [msg, setMsg] = useState("");
  const [busy, start] = useTransition();
  return (
    <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t.title}</h2>
        <p className="text-sm text-stone-600 mt-1 max-w-2xl">{t.note}</p>
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-medium">{t.emails}
        <input value={v} onChange={(e) => { setV(e.target.value); setMsg(""); }} dir="ltr" placeholder="ops@all-niche.com, manager@all-niche.com"
          className="h-10 rounded-lg border border-stone-300 px-3 text-sm font-normal" />
      </label>
      <div className="flex items-center gap-3">
        <button disabled={busy || v === initial} className="rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-4 py-2 text-sm font-semibold disabled:opacity-40"
          onClick={() => start(async () => { const r = await saveAlerts(v); setMsg(r.error === "invalid" ? t.invalid : r.error ? t.failed : t.saved); })}>{t.save}</button>
        {msg && <span role="status" className="text-sm text-stone-600">{msg}</span>}
      </div>
    </section>
  );
}
