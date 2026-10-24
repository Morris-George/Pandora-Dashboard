"use client";

import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { respondQuote, returnUnrepaired } from "./actions";

export type QuoteJob = {
  id: string; ticketNo: string; itemName: string; itemCode: string | null; status: string; branchName: string;
  customer: string; mobile: string; email: string; fault: string; cause: string; exclusion: string;
  lines: { desc: string; qty: number; price: number }[]; subtotal: number; tax: number; total: number; sentAt: string;
};
type T = (typeof dictionaries)["en"]["quotes"];
type Run = (fn: () => Promise<{ error?: string }>, after?: () => void) => void;

const card = "bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4";
const input = "rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-2 focus:outline-stone-900";
const DAY = 86_400_000;

export function QuotesPanel({ locale, jobs }: { locale: Locale; jobs: QuoteJob[] }) {
  const d = dictionaries[locale];
  const t = d.quotes;
  const [busy, start] = useTransition();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const money = (n: number) => n.toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const run: Run = (fn, after) =>
    start(async () => {
      setError(""); setNotice("");
      const r = await fn();
      if (r.error) { setError(t.errors[r.error] ?? t.errors.failed); return; }
      toast();
      after?.();
    });

  const waiting = jobs.filter((j) => j.status === "awaiting_customer_approval")
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const rejected = jobs.filter((j) => j.status === "quote_rejected");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{t.title}</h1>
      {error && <p role="alert" className="rounded-lg bg-red-50 text-red-800 text-sm p-3">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 text-emerald-900 text-sm p-3">{notice}</p>}

      <section className={card}>
        <div>
          <h2 className="text-lg font-semibold">{t.waitingTitle} <span className="text-sm font-normal text-stone-500">({waiting.length})</span></h2>
          <p className="text-sm text-stone-600 mt-1">{t.waitingNote}</p>
        </div>
        {!waiting.length && <p className="text-sm text-stone-600">{t.noneWaiting}</p>}
        {waiting.map((j) => (
          <QuoteCard key={j.id} t={t} j={j} money={money} busy={busy} run={run}
            age={Math.floor((Date.now() - new Date(j.sentAt).getTime()) / DAY)}
            exclusionLabel={j.exclusion ? d.diag.exclusions[j.exclusion] ?? j.exclusion : ""}
            onDone={(ok) => setNotice(ok ? t.approvedMsg(j.ticketNo) : t.rejectedMsg(j.ticketNo))} />
        ))}
      </section>

      <section className={card}>
        <div>
          <h2 className="text-lg font-semibold">{t.rejectedTitle} <span className="text-sm font-normal text-stone-500">({rejected.length})</span></h2>
          <p className="text-sm text-stone-600 mt-1">{t.rejectedNote}</p>
        </div>
        {!rejected.length && <p className="text-sm text-stone-600">{t.noneRejected}</p>}
        {rejected.map((j) => (
          <div key={j.id} className="border-t border-stone-100 pt-3 flex flex-wrap items-center gap-3">
            <div className="flex-[1_1_280px]">
              <div><a href={`/tracking?id=${j.id}`} className="font-semibold hover:underline" dir="ltr">{j.ticketNo}</a> · {j.itemName}</div>
              <div className="text-xs text-stone-600">{j.customer} · {j.branchName}</div>
            </div>
            <button disabled={busy} className="rounded-lg border border-stone-900 px-4 py-2 text-sm disabled:opacity-40"
              onClick={() => run(() => returnUnrepaired(j.id))}>{t.returnUnrepaired}</button>
          </div>
        ))}
      </section>
    </div>
  );
}

function QuoteCard({ t, j, money, busy, run, age, exclusionLabel, onDone }: {
  t: T; j: QuoteJob; money: (n: number) => string; busy: boolean; run: Run; age: number; exclusionLabel: string; onDone: (ok: boolean) => void;
}) {
  const [via, setVia] = useState<"phone_agent" | "link">("phone_agent");
  const [callRef, setCallRef] = useState("");
  const [reason, setReason] = useState("");
  const phoneOk = via === "link" || callRef.trim().length > 0;
  const answer = (approve: boolean) =>
    run(() => respondQuote({ ticketId: j.id, approve, via, callRef, reason }), () => onDone(approve));

  return (
    <div className="border-t border-stone-100 pt-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <a href={`/tracking?id=${j.id}`} className="font-semibold hover:underline" dir="ltr">{j.ticketNo}</a>
          <span className="mx-2">{j.itemName}</span>
          {j.itemCode && <span className="text-xs text-stone-500" dir="ltr">{j.itemCode}</span>}
        </div>
        <span className={`text-xs rounded-full px-2.5 py-1 ${age >= 3 ? "bg-red-100 text-red-900" : "bg-stone-100 text-stone-800"}`}>{t.waitingDays(age)}</span>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl border border-stone-200 p-3 flex flex-col gap-1">
          <span className="text-xs text-stone-500">{t.customer}</span>
          <strong>{j.customer}</strong>
          {j.mobile && <a href={`tel:${j.mobile}`} className="underline" dir="ltr">{j.mobile}</a>}
          {j.email && <span dir="ltr" className="text-stone-600">{j.email}</span>}
          <span className="text-xs text-stone-500">{j.branchName}</span>
        </div>
        <div className="rounded-xl border border-stone-200 p-3 flex flex-col gap-1">
          <span className="text-xs text-stone-500">{t.finding}</span>
          <span>{j.fault || "—"}</span>
          {j.cause && <span className="text-stone-600">{t.cause}: {j.cause}</span>}
          {exclusionLabel && <span className="text-stone-600">{t.whyNotCovered}: {exclusionLabel}</span>}
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-stone-500">
            <th className="p-1.5 text-start font-medium">{t.line}</th>
            <th className="p-1.5 text-end font-medium">{t.qty}</th>
            <th className="p-1.5 text-end font-medium">{t.price}</th>
            <th className="p-1.5 text-end font-medium">{t.amount}</th>
          </tr>
        </thead>
        <tbody>
          {j.lines.map((l, i) => (
            <tr key={i} className="border-t border-stone-100">
              <td className="p-1.5">{l.desc}</td>
              <td className="p-1.5 text-end tabular-nums">{l.qty}</td>
              <td className="p-1.5 text-end tabular-nums">{money(l.price)}</td>
              <td className="p-1.5 text-end tabular-nums">{money(l.qty * l.price)}</td>
            </tr>
          ))}
          <tr className="border-t border-stone-200 text-stone-600"><td className="p-1.5" colSpan={3}>{t.subtotal}</td><td className="p-1.5 text-end tabular-nums">{money(j.subtotal)}</td></tr>
          <tr className="text-stone-600"><td className="p-1.5" colSpan={3}>{t.vat}</td><td className="p-1.5 text-end tabular-nums">{money(j.tax)}</td></tr>
          <tr className="font-semibold"><td className="p-1.5" colSpan={3}>{t.total}</td><td className="p-1.5 text-end tabular-nums">{money(j.total)}</td></tr>
        </tbody>
      </table>

      <div className="rounded-xl bg-stone-50 border border-stone-200 p-3 flex flex-col gap-3">
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="text-sm font-medium mb-1">{t.channel}</legend>
          <label className="flex items-center gap-2"><input type="radio" name={`via-${j.id}`} checked={via === "phone_agent"} onChange={() => setVia("phone_agent")} /> {t.phone}</label>
          <label className="flex items-center gap-2"><input type="radio" name={`via-${j.id}`} checked={via === "link"} onChange={() => setVia("link")} /> {t.link}</label>
        </fieldset>
        <div className="flex flex-wrap gap-3">
          {via === "phone_agent" && (
            <label className="flex flex-col gap-1.5 text-sm font-medium">{t.callRef}
              <input value={callRef} onChange={(e) => setCallRef(e.target.value)} dir="ltr" className={`${input} w-52`} />
            </label>
          )}
          <label className="flex flex-col gap-1.5 text-sm font-medium flex-[1_1_240px]">{t.rejectReason}
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={input} />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button disabled={busy || !phoneOk} onClick={() => answer(true)}
            className="rounded-lg bg-emerald-800 text-white px-4 py-2 text-sm font-semibold disabled:opacity-40">{t.approve}</button>
          <button disabled={busy || !phoneOk || !reason.trim()} onClick={() => answer(false)}
            className="rounded-lg border border-red-800 text-red-800 px-4 py-2 text-sm disabled:opacity-40">{t.reject}</button>
        </div>
      </div>
    </div>
  );
}
