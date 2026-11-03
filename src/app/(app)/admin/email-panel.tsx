"use client";

import { useState, useTransition } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { saveMailSettings, testEmail } from "./actions";

export type MailForm = { host: string; port: string; username: string; fromName: string; fromEmail: string; paused: boolean; hasPassword: boolean };

// Mail server for customer emails. The password is write-only: it is never sent back to the page.
export function EmailPanel({ locale, initial, myEmail }: { locale: Locale; initial: MailForm; myEmail: string }) {
  const t = dictionaries[locale].admin.mail;
  const [f, setF] = useState(initial);
  const [password, setPassword] = useState("");
  const [to, setTo] = useState(myEmail);
  const [msg, setMsg] = useState("");
  const [busy, start] = useTransition();
  const input = "rounded-lg border border-stone-300 px-3 py-2 text-sm";
  const field = (k: "host" | "port" | "username" | "fromName" | "fromEmail", label: string, ltr = true) => (
    <label className="flex flex-col gap-1.5 text-sm font-medium">{label}
      <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} dir={ltr ? "ltr" : undefined} className={`${input} font-normal`} />
    </label>
  );
  const save = (paused = f.paused) => start(async () => {
    setMsg("");
    const r = await saveMailSettings({ ...f, paused, password }).catch(() => ({ error: "failed" }));
    if (r.error) setMsg(t.failed);
    else { setF({ ...f, paused, hasPassword: f.hasPassword || !!password }); setPassword(""); setMsg(t.saved); }
  });

  return (
    <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t.title}</h2>
        <p className="text-sm text-stone-600 mt-1">{t.note}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {field("host", t.host)}
        {field("port", t.port)}
        {field("username", t.username)}
        <label className="flex flex-col gap-1.5 text-sm font-medium">{t.password}
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr"
            placeholder={f.hasPassword ? t.passwordKeep : ""} className={`${input} font-normal`} />
        </label>
        {field("fromName", t.fromName, false)}
        {field("fromEmail", t.fromEmail)}
      </div>
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} onClick={() => save()} className="rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-4 py-2 text-sm font-bold disabled:opacity-40">{t.save}</button>
      </div>

      <div className="flex flex-wrap items-end gap-2 border-t border-stone-100 pt-4">
        <label className="flex flex-col gap-1.5 text-sm font-medium flex-[1_1_240px]">{t.testTo}
          <input type="email" value={to} onChange={(e) => setTo(e.target.value)} dir="ltr" className={`${input} font-normal`} />
        </label>
        <button disabled={busy || !to.trim()} onClick={() => start(async () => {
          setMsg("");
          const r = await testEmail(to).catch(() => ({ error: "failed" } as { error?: string; to?: string }));
          setMsg(r.error ? `${t.testFailed}: ${r.error}` : t.testSent(r.to ?? to));
        })} className="rounded-lg border border-stone-900 px-4 py-2 text-sm font-bold disabled:opacity-40">{t.test}</button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-4">
        <div>
          <div className="font-medium">{t.customerEmails}</div>
          <p className={`text-sm font-semibold mt-1 ${f.paused ? "text-amber-800" : "text-emerald-800"}`}>{f.paused ? t.paused : t.active}</p>
        </div>
        <button disabled={busy} onClick={() => save(!f.paused)}
          className={`rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-40 ${f.paused ? "bg-[var(--accent)] text-[var(--on-accent)]" : "border border-stone-900"}`}>
          {f.paused ? t.resume : t.pause}
        </button>
      </div>
      {msg && <p role="status" className="text-sm text-stone-700 break-all">{msg}</p>}
    </section>
  );
}
