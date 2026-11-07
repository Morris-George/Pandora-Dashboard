"use client";

import { useState, useTransition } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { saveCustomerContact, type CustomerContact } from "./actions";

// Contact line under the customer tracking page: wording plus optional phone and email
export function ContactPanel({ locale, initial }: { locale: Locale; initial: CustomerContact }) {
  const t = dictionaries[locale].admin.contact;
  const [v, setV] = useState<CustomerContact>(initial);
  const [msg, setMsg] = useState("");
  const [busy, start] = useTransition();
  const input = "rounded-lg border border-stone-300 px-3 py-2 text-sm font-normal";
  const field = (k: keyof CustomerContact, label: string, dir: "ltr" | "rtl" = "ltr") => (
    <label className="flex flex-col gap-1.5 text-sm font-medium flex-[1_1_240px]">{label}
      <input value={v[k] ?? ""} dir={dir} onChange={(e) => setV({ ...v, [k]: e.target.value })} className={input} />
    </label>
  );
  return (
    <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t.title}</h2>
        <p className="text-sm text-stone-600 mt-1">{t.note}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        {field("en", t.english)}
        {field("ar", t.arabic, "rtl")}
      </div>
      <div className="flex flex-wrap gap-3">
        {field("phone", t.phone)}
        {field("email", t.email)}
      </div>
      <div className="flex items-center gap-3">
        <button disabled={busy} className="rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-4 py-2 text-sm font-semibold disabled:opacity-40"
          onClick={() => start(async () => { const r = await saveCustomerContact(v); setMsg(r.error ? t.failed : t.saved); })}>{t.save}</button>
        {msg && <span className="text-sm text-stone-600">{msg}</span>}
      </div>
    </section>
  );
}
