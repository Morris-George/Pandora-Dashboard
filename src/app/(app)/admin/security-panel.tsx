"use client";

import { useState, useTransition } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { Dialog } from "@/components/dialog";
import { setTwoStep } from "./actions";

// Security settings: two-step login for Super Admins (on by default)
export function SecurityPanel({ locale, twoStep }: { locale: Locale; twoStep: boolean }) {
  const t = dictionaries[locale].admin.security;
  const [busy, start] = useTransition();
  const [ask, setAsk] = useState(false);
  const [error, setError] = useState("");
  const apply = (on: boolean) => start(async () => {
    setError("");
    const r = await setTwoStep(on).catch(() => ({ error: "failed" }));
    if (r.error) setError(t.failed); else setAsk(false);
  });

  return (
    <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-wrap items-center justify-between gap-4">
      <div className="max-w-2xl">
        <h2 className="text-lg font-semibold">{t.title}</h2>
        <p className="text-sm text-stone-600 mt-1">{t.note}</p>
        <p className={`text-sm font-semibold mt-2 ${twoStep ? "text-emerald-800" : "text-red-800"}`}>{twoStep ? t.on : t.off}</p>
        {error && <p role="alert" className="text-sm text-red-800 mt-1">{error}</p>}
      </div>
      <button disabled={busy} onClick={() => (twoStep ? setAsk(true) : apply(true))}
        className={`rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-40 ${twoStep ? "border border-red-800 text-red-800" : "bg-[var(--accent)] text-[var(--on-accent)]"}`}>
        {twoStep ? t.turnOff : t.turnOn}
      </button>
      <Dialog open={ask} title={t.turnOff} onClose={() => setAsk(false)}>
        <p className="text-sm text-stone-700">{t.warn}</p>
        <div className="flex gap-2 justify-end">
          <button onClick={() => setAsk(false)} className="rounded-lg border border-stone-300 px-4 py-2 text-sm">{t.keep}</button>
          <button disabled={busy} onClick={() => apply(false)} className="rounded-lg bg-red-800 text-white px-4 py-2 text-sm font-bold">{t.confirmOff}</button>
        </div>
      </Dialog>
    </section>
  );
}
