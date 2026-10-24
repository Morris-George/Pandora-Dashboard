"use client";

import { useState, useTransition } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { setBranchWhatsapp } from "./actions";

const input = "rounded-lg border border-stone-300 px-3 py-2 text-sm font-normal focus:outline-2 focus:outline-stone-900";

// Admin → Stores: each store's WhatsApp number (printed on receipts, shown on the tracking page)
export function StoresPanel({ locale, stores }: { locale: Locale; stores: { id: string; name: string; whatsapp: string | null }[] }) {
  const t = dictionaries[locale].admin.stores;
  const [busy, start] = useTransition();
  const [values, setValues] = useState(Object.fromEntries(stores.map((s) => [s.id, s.whatsapp ?? ""])));
  const [msg, setMsg] = useState<{ id: string; ok: boolean } | null>(null);

  const save = (id: string) => start(async () => {
    setMsg(null);
    const r = await setBranchWhatsapp(id, values[id]).catch(() => ({ error: "failed" }));
    if (!r.error && "value" in r) setValues({ ...values, [id]: r.value ?? "" });
    setMsg({ id, ok: !r.error });
  });

  return (
    <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t.title}</h2>
        <p className="text-sm text-stone-600 mt-1 max-w-2xl">{t.note}</p>
      </div>
      <div className="flex flex-col gap-2">
        {stores.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2 border-t border-stone-100 pt-2">
            <span className="text-sm flex-[1_1_200px]">{s.name}</span>
            <input value={values[s.id]} onChange={(e) => { setValues({ ...values, [s.id]: e.target.value }); setMsg(null); }}
              placeholder="01xxxxxxxxx" inputMode="tel" dir="ltr" aria-label={`${t.whatsapp} — ${s.name}`} className={`${input} w-48`} />
            <button disabled={busy || values[s.id] === (s.whatsapp ?? "")} onClick={() => save(s.id)}
              className="rounded-lg border border-stone-900 px-3 py-2 text-sm disabled:opacity-40">{t.save}</button>
            {msg?.id === s.id && <span role="status" className={`text-xs ${msg.ok ? "text-emerald-800" : "text-red-800"}`}>{msg.ok ? t.saved : t.invalid}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}
