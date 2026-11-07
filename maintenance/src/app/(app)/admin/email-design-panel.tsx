"use client";

import { useState, useTransition } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { EMAIL_COPY, EMAIL_DESIGN, EMAIL_KINDS, emailSubject, renderEmail, resolve, type EmailCopy, type EmailDesign, type EmailKind, type EmailTemplates } from "@/lib/email-templates";
import { saveEmailTemplates } from "./actions";

const input = "rounded-lg border border-stone-300 px-3 py-2 text-sm font-normal";
const COLORS: (keyof EmailDesign)[] = ["headerColor", "headerText", "buttonColor", "buttonText", "background"];
const TEXTS: (keyof EmailDesign)[] = ["brand", "button", "greeting", "footerAr", "footerEn"];

// Admin → Email design: colours, header, button, footer and each email's subject/text, with a live preview
export function EmailDesignPanel({ locale, initial }: { locale: Locale; initial: EmailTemplates }) {
  const t = dictionaries[locale].admin.emailDesign;
  const [design, setDesign] = useState<EmailDesign>(() => resolve(initial, "received").d);
  const [kinds, setKinds] = useState(() => Object.fromEntries(EMAIL_KINDS.map((k) => [k, resolve(initial, k).c])) as Record<EmailKind, EmailCopy>);
  const [kind, setKind] = useState<EmailKind>("received");
  const [msg, setMsg] = useState("");
  const [busy, start] = useTransition();
  const tpl: EmailTemplates = { design, kinds };
  const c = kinds[kind];
  const setC = (k: keyof EmailCopy, v: string) => { setKinds({ ...kinds, [kind]: { ...c, [k]: v } }); setMsg(""); };
  const setD = (k: keyof EmailDesign, v: string) => { setDesign({ ...design, [k]: v }); setMsg(""); };

  return (
    <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t.title}</h2>
        <p className="text-sm text-stone-600 mt-1 max-w-2xl">{t.note}</p>
      </div>
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold mb-1">{t.look}</legend>
            <div className="flex flex-wrap gap-3">
              {COLORS.map((k) => (
                <label key={k} className="flex items-center gap-2 text-xs">
                  <input type="color" value={design[k]} onChange={(e) => setD(k, e.target.value)} className="h-8 w-10 rounded border border-stone-300" />{t.f[k]}
                </label>
              ))}
            </div>
            {TEXTS.map((k) => (
              <label key={k} className="flex flex-col gap-1 text-xs font-medium">{t.f[k]}
                <input value={design[k]} onChange={(e) => setD(k, e.target.value)} dir={k === "footerEn" || k === "brand" ? "ltr" : "rtl"} className={input} />
              </label>
            ))}
            <button type="button" className="self-start text-xs underline" onClick={() => setDesign(EMAIL_DESIGN)}>{t.reset}</button>
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold mb-1">{t.email}</legend>
            <div className="flex flex-wrap gap-1.5">
              {EMAIL_KINDS.map((k) => (
                <button key={k} type="button" onClick={() => setKind(k)}
                  className={`rounded-full px-3 py-1 text-xs border ${k === kind ? "bg-stone-900 text-white border-stone-900" : "border-stone-300"}`}>{t.kinds[k]}</button>
              ))}
            </div>
            <label className="flex flex-col gap-1 text-xs font-medium">{t.f.subject}
              <input value={c.subject} onChange={(e) => setC("subject", e.target.value)} dir="rtl" className={input} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">{t.f.ar}
              <textarea rows={4} value={c.ar} onChange={(e) => setC("ar", e.target.value)} dir="rtl" className={input} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">{t.f.en}
              <textarea rows={3} value={c.en} onChange={(e) => setC("en", e.target.value)} dir="ltr" className={input} />
            </label>
            <button type="button" className="self-start text-xs underline" onClick={() => setKinds({ ...kinds, [kind]: EMAIL_COPY[kind] })}>{t.reset}</button>
          </fieldset>
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-sm text-stone-600" dir="rtl"><b>{t.f.subject}:</b> {emailSubject(tpl, kind, "CFC-10051")}</div>
          <iframe title={t.title} className="w-full h-[560px] rounded-xl border border-stone-200 bg-white"
            srcDoc={renderEmail(tpl, kind, "Ahmed Ali", "CFC-10051", "Pandora Moments bracelet", "#")} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button disabled={busy} className="rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-4 py-2 text-sm font-semibold disabled:opacity-40"
          onClick={() => start(async () => { const r = await saveEmailTemplates(tpl); setMsg(r.error ? t.failed : t.saved); })}>{t.save}</button>
        {msg && <span role="status" className="text-sm text-stone-600">{msg}</span>}
      </div>
    </section>
  );
}
