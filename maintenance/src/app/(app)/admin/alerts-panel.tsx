"use client";

import { useState, useTransition } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { saveAlerts } from "./actions";

const valid = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const parse = (s: string) => s.split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean);

// Who is emailed when a bag arrives short or an item is confirmed lost: one row per address
export function AlertsPanel({ locale, initial }: { locale: Locale; initial: string }) {
  const t = dictionaries[locale].admin.alerts;
  const [list, setList] = useState<string[]>(parse(initial));
  const [saved, setSaved] = useState(parse(initial).join(", "));
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, start] = useTransition();
  const input = "h-10 rounded-lg border border-stone-300 px-3 text-sm font-normal";

  const add = () => {
    const more = parse(draft);
    if (!more.length) return;
    if (more.some((e) => !valid(e))) { setMsg(t.invalid); return; }
    setList([...list, ...more.filter((e) => !list.includes(e))].slice(0, 10)); setDraft(""); setMsg("");
  };
  const save = (next: string[]) => start(async () => {
    const r = await saveAlerts(next.join(", "));
    if (!r.error) setSaved(next.join(", "));
    setMsg(r.error === "invalid" ? t.invalid : r.error ? t.failed : t.saved);
  });

  return (
    <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t.title}</h2>
        <p className="text-sm text-stone-600 mt-1 max-w-2xl">{t.note}</p>
      </div>
      <div className="flex flex-col gap-2 max-w-xl">
        {list.map((e) => (
          <div key={e} className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 h-10 text-sm">
            <span dir="ltr" className="flex-1 truncate">{e}</span>
            <button type="button" aria-label={`${t.remove} ${e}`} className="text-xs font-semibold text-red-800 hover:underline"
              onClick={() => { setList(list.filter((x) => x !== e)); setMsg(""); }}>{t.remove}</button>
          </div>
        ))}
        {list.length < 10 && (
          <div className="flex gap-2">
            <input value={draft} onChange={(e) => { setDraft(e.target.value); setMsg(""); }} dir="ltr" placeholder="name@all-niche.com"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} aria-label={t.emails} className={`${input} flex-1`} />
            <button type="button" disabled={!draft.trim()} onClick={add} className="h-10 rounded-lg border border-stone-900 px-4 text-sm disabled:opacity-40">+ {t.add}</button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button disabled={busy || list.join(", ") === saved} className="rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-4 py-2 text-sm font-semibold disabled:opacity-40"
          onClick={() => save(list)}>{t.save}</button>
        {msg && <span role="status" className="text-sm text-stone-600">{msg}</span>}
      </div>
    </section>
  );
}
