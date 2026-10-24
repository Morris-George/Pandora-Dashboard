"use client";

import { useState, useTransition } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import type { AppRole } from "@/lib/auth";
import { collect, findRepairInvoice, markUncollected, type RepairInvoice } from "./actions";

export type PickupJob = {
  id: string; ticketNo: string; itemName: string; itemCode: string | null; status: string; branchName: string;
  customer: string; mobileHint: string; readyAt: string | null; outcome: "repaired" | "rejected" | "unrepairable";
  warranty: string; due: number;
};
type D = (typeof dictionaries)["en"];
type Run = (fn: () => Promise<{ error?: string; outcome?: string }>, after?: (outcome?: string) => void) => void;

const input = "rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-2 focus:outline-stone-900";
const DAY = 86_400_000;

export function PickupPanel({ locale, role, jobs }: { locale: Locale; role: AppRole; jobs: PickupJob[] }) {
  const d = dictionaries[locale];
  const t = d.pickup;
  const [busy, start] = useTransition();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [doneId, setDoneId] = useState(""); // last handed-over ticket, for the delivery receipt
  const [q, setQ] = useState("");
  const money = (n: number) => n.toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const run: Run = (fn, after) =>
    start(async () => {
      setError(""); setNotice("");
      const r = await fn();
      if (r.error) { setError(t.errors[r.error] ?? t.errors.failed); return; }
      after?.(r.outcome);
    });

  const term = q.trim().toLowerCase();
  const shown = term ? jobs.filter((j) => [j.ticketNo, j.customer, j.itemName, j.itemCode ?? ""].some((s) => s.toLowerCase().includes(term))) : jobs;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{t.title}</h1>
      {error && <p role="alert" className="rounded-lg bg-red-50 text-red-800 text-sm p-3">{error}</p>}
      {notice && (
        <div role="status" className="rounded-lg bg-emerald-50 text-emerald-900 text-sm p-3 flex flex-wrap items-center justify-between gap-2">
          <span>{notice}</span>
          {doneId && <a href={`/receipt/${doneId}?kind=delivery`} target="_blank" rel="noopener" className="rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-3 py-1.5 font-bold">{t.printDelivery}</a>}
        </div>
      )}

      <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold">{t.waitingTitle} <span className="text-sm font-normal text-stone-500">({jobs.length})</span></h2>
          <p className="text-sm text-stone-600 mt-1">{t.note}</p>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} aria-label={t.search} className={input} />
        {!shown.length && <p className="text-sm text-stone-600">{t.none}</p>}
        {shown.map((j) => (
          <PickupCard key={j.id} d={d} j={j} role={role} busy={busy} run={run} money={money}
            onDone={(o) => { setNotice(o === "closed" ? t.closedMsg(j.ticketNo) : t.collectedMsg(j.ticketNo)); setDoneId(j.id); }} />
        ))}
      </section>
    </div>
  );
}

function PickupCard({ d, j, role, busy, run, money, onDone }: {
  d: D; j: PickupJob; role: AppRole; busy: boolean; run: Run; money: (n: number) => string; onDone: (o?: string) => void;
}) {
  const t = d.pickup;
  const [open, setOpen] = useState(false);
  const [last4, setLast4] = useState("");
  const [other, setOther] = useState(false);
  const [collectedBy, setCollectedBy] = useState("");
  const [invoice, setInvoice] = useState("");
  const [found, setFound] = useState<RepairInvoice | { status: "busy" } | null>(null);
  const lookup = async () => {
    setFound({ status: "busy" });
    const r = await findRepairInvoice(j.ticketNo, invoice);
    if (r.status === "found") setInvoice(r.invoiceNo);
    setFound(r);
  };
  const [reason, setReason] = useState("");
  const age = j.readyAt ? Math.floor((Date.now() - new Date(j.readyAt).getTime()) / DAY) : 0;
  const pay = j.due > 0;
  const ok = /^\d{4}$/.test(last4) && (!other || collectedBy.trim()) && (!pay || found?.status === "found");
  const OUTCOME: Record<PickupJob["outcome"], string> = { repaired: "bg-emerald-100 text-emerald-900", rejected: "bg-stone-100 text-stone-800", unrepairable: "bg-red-100 text-red-900" };

  return (
    <div className="border-t border-stone-100 pt-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <a href={`/tracking?id=${j.id}`} className="font-semibold hover:underline" dir="ltr">{j.ticketNo}</a>
        <span>{j.itemName}</span>
        <span className={`text-xs rounded-full px-2.5 py-1 ${OUTCOME[j.outcome]}`}>{t.outcome[j.outcome]}</span>
        {j.status === "uncollected" && <span className="text-xs rounded-full px-2.5 py-1 bg-amber-100 text-amber-900">{d.status.uncollected}</span>}
        <span className="flex-1" />
        <span className={`text-xs ${age > 30 ? "text-red-800 font-semibold" : "text-stone-500"}`}>{t.waitingDays(age)}</span>
      </div>
      <div className="text-sm text-stone-700 flex flex-wrap gap-x-4">
        <span>{j.customer} <span dir="ltr" className="text-stone-500">{j.mobileHint}</span></span>
        <span>{d.warranty[j.warranty as keyof D["warranty"]]}</span>
        <strong>{pay ? t.due(money(j.due)) : t.nothingDue}</strong>
      </div>

      {!open ? (
        <div className="flex flex-wrap gap-2 items-end">
          <button className="rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-4 py-2 text-sm font-semibold" onClick={() => setOpen(true)}>{t.start}</button>
          {role === "manager" && j.status === "ready_for_pickup" && (
            <>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.uncollectedReason} aria-label={t.uncollectedReason} className={`${input} flex-[1_1_220px]`} />
              <button disabled={busy || !reason.trim()} className="rounded-lg border border-amber-700 text-amber-800 px-4 py-2 text-sm disabled:opacity-40"
                onClick={() => run(() => markUncollected(j.id, reason))}>{t.markUncollected}</button>
            </>
          )}
        </div>
      ) : (
        <div className="rounded-xl bg-stone-50 border border-stone-200 p-4 flex flex-col gap-3">
          <ol className="text-sm text-stone-700 list-decimal ps-5 flex flex-col gap-1">
            {t.steps.map((s) => <li key={s}>{s}</li>)}
          </ol>
          <label className="flex flex-col gap-1.5 text-sm font-medium self-start">{t.last4}
            <input value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" dir="ltr" className={`${input} w-28 tracking-widest`} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={other} onChange={(e) => setOther(e.target.checked)} /> {t.someoneElse}
          </label>
          {other && (
            <label className="flex flex-col gap-1.5 text-sm font-medium">{t.collectorName}
              <input value={collectedBy} onChange={(e) => setCollectedBy(e.target.value)} className={input} />
            </label>
          )}
          {pay && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">{t.invoiceStep(money(j.due), j.ticketNo)}</span>
              <div className="flex flex-wrap gap-2 items-end">
                <label className="flex flex-col gap-1.5 text-sm font-medium">{t.erpInvoice}
                  <input value={invoice} onChange={(e) => { setInvoice(e.target.value); setFound(null); }} dir="ltr" placeholder="INV-…"
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); lookup(); } }} className={`${input} w-56`} />
                </label>
                <button type="button" onClick={lookup} disabled={found?.status === "busy"}
                  className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40">
                  {found?.status === "busy" ? t.checking : invoice.trim() ? t.checkInvoice : t.findByTicket}
                </button>
              </div>
              {found && found.status !== "busy" && (
                <p className={`text-sm rounded-lg p-2.5 ${found.status === "found" ? (found.total + 0.01 >= j.due ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900") : "bg-stone-50 text-stone-700"}`}>
                  {found.status === "found"
                    ? t.invoiceFound(found.invoiceNo, money(found.total), found.date) + (found.total + 0.01 >= j.due ? "" : " " + t.invoiceLow(money(j.due)))
                    : t.invoiceMsg[found.status]}
                </p>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button disabled={busy || !ok} className="rounded-lg bg-emerald-800 text-white px-4 py-2 text-sm font-semibold disabled:opacity-40"
              onClick={() => run(() => collect({ ticketId: j.id, last4, erpInvoice: pay ? invoice : "", collectedBy: other ? collectedBy : "" }), onDone)}>
              {t.confirm}
            </button>
            <button className="rounded-lg border border-stone-900 px-4 py-2 text-sm" onClick={() => setOpen(false)}>{t.cancel}</button>
          </div>
        </div>
      )}
    </div>
  );
}
