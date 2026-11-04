"use client";

import { useState, useTransition } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import type { Bilingual, ReceiptSettings } from "@/lib/receipt-settings";
import { saveReceiptSettings } from "./actions";

const input = "rounded-lg border border-stone-300 px-3 py-2 text-sm font-normal focus:outline-2 focus:outline-stone-900";

// Admin → Receipt: logo, contact line, which fields print, terms and footer (Arabic + English)
export function ReceiptPanel({ locale, initial }: { locale: Locale; initial: ReceiptSettings }) {
  const t = dictionaries[locale].admin.receipt;
  const [s, setS] = useState(initial);
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof ReceiptSettings>(k: K, v: ReceiptSettings[K]) => { setS({ ...s, [k]: v }); setMsg(null); };
  const setBi = (k: "termsIntake" | "termsDelivery" | "footer", lang: keyof Bilingual, v: string) => set(k, { ...s[k], [lang]: v });

  const pickLogo = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 300_000) { setMsg({ ok: false, text: t.logoTooBig }); return; }
    const r = new FileReader();
    r.onload = () => { setS({ ...s, logo: "custom", customLogo: String(r.result) }); setMsg(null); };
    r.readAsDataURL(f);
  };

  const bi = (k: "termsIntake" | "termsDelivery" | "footer", label: string) => (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium mb-1">{label}</legend>
      <textarea value={s[k].ar} onChange={(e) => setBi(k, "ar", e.target.value)} dir="rtl" rows={2} placeholder={t.arabic} className={input} />
      <textarea value={s[k].en} onChange={(e) => setBi(k, "en", e.target.value)} dir="ltr" rows={2} placeholder={t.english} className={input} />
    </fieldset>
  );

  return (
    <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t.title}</h2>
          <p className="text-sm text-stone-600 mt-1 max-w-2xl">{t.note}</p>
        </div>
        <div className="flex gap-2">
          <a href="/receipt/sample" target="_blank" rel="noopener" className="rounded-lg border border-stone-900 px-3 py-2 text-sm">{t.previewIntake}</a>
          <a href="/receipt/sample?kind=delivery" target="_blank" rel="noopener" className="rounded-lg border border-stone-900 px-3 py-2 text-sm">{t.previewDelivery}</a>
          <a href="/label/sample" target="_blank" rel="noopener" className="rounded-lg border border-stone-900 px-3 py-2 text-sm">{t.previewLabel}</a>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium mb-1">{t.qrTarget}</legend>
          {(["tracking", "website"] as const).map((v) => (
            <label key={v} className="flex items-center gap-2 text-sm">
              <input type="radio" checked={s.qrTarget === v} onChange={() => set("qrTarget", v)} disabled={v === "website" && !s.website.trim()} />
              {t.qrOptions[v]}
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium mb-1">{t.logo}</legend>
          {(["pandora", "custom", "none"] as const).map((v) => (
            <label key={v} className="flex items-center gap-2 text-sm">
              <input type="radio" checked={s.logo === v} onChange={() => set("logo", v)} disabled={v === "custom" && !s.customLogo} />
              {t.logoOptions[v]}
            </label>
          ))}
          <input type="file" accept="image/png,image/jpeg" onChange={(e) => pickLogo(e.target.files?.[0])} className="text-sm" />
          {s.customLogo && (
            // eslint-disable-next-line @next/next/no-img-element -- data: URL chosen by the admin
            <img src={s.customLogo} alt="" className="h-14 w-auto self-start border border-stone-200 rounded p-1 bg-white" />
          )}
        </fieldset>

        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm font-medium">{t.storeLine}
            <input value={s.storeLine} onChange={(e) => set("storeLine", e.target.value)} className={input} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">{t.phone}
            <input value={s.phone} onChange={(e) => set("phone", e.target.value)} dir="ltr" className={input} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">{t.website}
            <input value={s.website} onChange={(e) => set("website", e.target.value)} dir="ltr" className={input} />
          </label>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium mb-1">{t.fields}</legend>
          {(["showCustomer", "showMobile", "showItemCode", "showFault", "showAccessories", "showWhatsapp", "showAgreed", "showQr", "showScanText", "showTerms", "showSignature", "showFooter"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={s[k]} onChange={(e) => set(k, e.target.checked)} /> {t.fieldNames[k]}
            </label>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium mb-1">{t.labelSize}</legend>
          <div className="flex items-center gap-2 text-sm" dir="ltr">
            <input value={s.labelWidth} onChange={(e) => set("labelWidth", Number(e.target.value.replace(/[^\d]/g, "")) || 0)} inputMode="numeric" aria-label={t.labelWidth} className={`${input} w-20 text-center`} />
            <span>×</span>
            <input value={s.labelHeight} onChange={(e) => set("labelHeight", Number(e.target.value.replace(/[^\d]/g, "")) || 0)} inputMode="numeric" aria-label={t.labelHeight} className={`${input} w-20 text-center`} />
            <span>mm</span>
          </div>
          <span className="text-xs text-stone-500">{t.labelNote}</span>
        </fieldset>
        {bi("footer", t.footer)}
        {bi("termsIntake", t.termsIntake)}
        {bi("termsDelivery", t.termsDelivery)}
      </div>
      <p className="text-xs text-stone-500">{t.emptyNote}</p>

      {msg && <p role="status" className={`rounded-lg text-sm p-3 ${msg.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}>{msg.text}</p>}
      <button disabled={busy} className="self-start rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-5 py-2.5 text-sm font-bold disabled:opacity-40"
        onClick={() => start(async () => {
          const r = await saveReceiptSettings(s).catch(() => ({ error: "failed" }));
          setMsg(r.error ? { ok: false, text: t.failed } : { ok: true, text: t.saved });
        })}>{t.save}</button>
    </section>
  );
}
