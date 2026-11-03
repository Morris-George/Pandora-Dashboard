"use client";

import { useState, useTransition } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { WA_DEFAULTS, WA_KINDS, type WaTemplates } from "@/lib/whatsapp";
import { saveWaTemplates } from "./actions";

// WhatsApp messages the store sends to customers. Each box starts with the built-in text.
export function WhatsappPanel({ locale, initial }: { locale: Locale; initial: WaTemplates }) {
  const t = dictionaries[locale].admin.wa;
  const [tpl, setTpl] = useState<WaTemplates>(() => Object.fromEntries(WA_KINDS.map((k) => [k, initial[k] || WA_DEFAULTS[k]])));
  const [msg, setMsg] = useState("");
  const [busy, start] = useTransition();

  return (
    <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t.title}</h2>
        <p className="text-sm text-stone-600 mt-1">{t.note}</p>
        <p className="text-xs text-stone-500 mt-1" dir="ltr">{"{name} {ticket} {item} {store} {link} {quote}"}</p>
      </div>
      {WA_KINDS.map((k) => (
        <label key={k} className="flex flex-col gap-1.5 text-sm font-medium">
          <span className="flex items-center gap-3">{t.kinds[k]}
            <button type="button" className="text-xs underline font-normal" onClick={() => setTpl({ ...tpl, [k]: WA_DEFAULTS[k] })}>{t.reset}</button>
          </span>
          <textarea rows={7} dir="rtl" value={tpl[k] ?? ""} onChange={(e) => setTpl({ ...tpl, [k]: e.target.value })}
            className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-normal" />
        </label>
      ))}
      <div className="flex items-center gap-3">
        <button disabled={busy} className="rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-4 py-2 text-sm font-semibold disabled:opacity-40"
          onClick={() => start(async () => {
            // Save only what differs from the built-in text
            const changed = Object.fromEntries(WA_KINDS.filter((k) => (tpl[k] ?? "").trim() && tpl[k]!.trim() !== WA_DEFAULTS[k].trim()).map((k) => [k, tpl[k]!]));
            const r = await saveWaTemplates(changed);
            setMsg(r.error ? t.failed : t.saved);
          })}>{t.save}</button>
        {msg && <span className="text-sm text-stone-600">{msg}</span>}
      </div>
    </section>
  );
}
