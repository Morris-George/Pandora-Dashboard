"use client";

import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import type { AppRole } from "@/lib/auth";
import { completeRepair, decideOverride, moveTicket, startDiagnosis, submitDiagnosis } from "./actions";

export type Job = {
  id: string; ticketNo: string; itemName: string; itemCode: string | null; branchName: string;
  fault: string; faultNotes: string | null; provisional: string; noInvoice: boolean; purchaseDate: string | null;
  status: string; technician: string | null;
  overridePending: boolean; overrideMine: boolean; overrideReason: string | null; decision: string | null; finding: string | null;
};
type D = (typeof dictionaries)["en"];
type Run = (fn: () => Promise<{ error?: string; outcome?: string }>, after?: () => void) => void;

const card = "bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4";
const input = "rounded-lg border border-stone-300 px-3 py-2 text-sm font-normal focus:outline-2 focus:outline-stone-900";
const primary = "rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-4 py-2 text-sm font-semibold disabled:opacity-40";
const ghost = "rounded-lg border border-stone-900 px-4 py-2 text-sm disabled:opacity-40";
const danger = "rounded-lg border border-red-800 text-red-800 px-4 py-2 text-sm disabled:opacity-40";
const VAT = 0.14;

export function DiagnosisPanel({ locale, role, jobs, technicians, costs }: {
  locale: Locale; role: AppRole; jobs: Job[]; technicians: { id: string; name: string }[]; costs: Record<string, { name: string; price: number }[]>;
}) {
  const d = dictionaries[locale];
  const t = d.diag;
  const [busy, start] = useTransition();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const run: Run = (fn, after) =>
    start(async () => {
      setError(""); setNotice("");
      const r = await fn();
      if (r.error) { setError(t.errors[r.error] ?? t.errors.failed); return; }
      toast();
      if (r.outcome === "override_pending") setNotice(t.sentForOverride);
      after?.();
    });

  const by = (s: string) => jobs.filter((j) => j.status === s);
  const toAssign = by("received_at_hq");
  const diagnosing = by("under_diagnosis");
  const overrides = diagnosing.filter((j) => j.overridePending);
  const toDiagnose = diagnosing.filter((j) => !j.overridePending);
  const sup = role === "supervisor";
  const tech = role === "technician";
  const p = { d, t, busy, run };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{t.title}</h1>
      {error && <p role="alert" className="rounded-lg bg-red-50 text-red-800 text-sm p-3">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 text-emerald-900 text-sm p-3">{notice}</p>}

      {(sup || role === "hq") && (
        <Section title={t.assignTitle} note={t.assignNote} empty={t.noneAssign} count={toAssign.length}>
          {toAssign.map((j) => <AssignRow key={j.id} {...p} j={j} technicians={technicians} />)}
        </Section>
      )}

      {sup && overrides.length > 0 && (
        <Section title={t.overrideTitle} note={t.overrideNote} count={overrides.length}>
          {overrides.map((j) => (
            <div key={j.id} className="border-t border-stone-100 pt-3 flex flex-col gap-2">
              <JobHead d={d} j={j} />
              <p className="text-sm">{t.overrideLine(d.warranty[j.provisional as keyof D["warranty"]], d.warranty[j.decision as keyof D["warranty"]])}</p>
              <p className="text-sm text-stone-700">{t.reason}: {j.overrideReason}</p>
              {j.overrideMine ? <p className="text-xs text-stone-500">{t.errors.sod}</p> : (
                <div className="flex gap-2">
                  <button disabled={busy} className={primary} onClick={() => run(() => decideOverride(j.id, true))}>{t.approve}</button>
                  <button disabled={busy} className={danger} onClick={() => run(() => decideOverride(j.id, false))}>{t.reject}</button>
                </div>
              )}
            </div>
          ))}
        </Section>
      )}

      {(sup || tech) && (
        <Section title={t.diagnoseTitle} empty={t.noneDiagnose} count={toDiagnose.length}>
          {toDiagnose.map((j) => <DiagnoseForm key={j.id} {...p} j={j} supervisor={sup} costs={(j.itemCode && costs[j.itemCode]) || []} />)}
          {tech && overrides.map((j) => (
            <div key={j.id} className="border-t border-stone-100 pt-3"><JobHead d={d} j={j} /><p className="text-sm text-amber-800 mt-1">{t.waitingOverride}</p></div>
          ))}
        </Section>
      )}

      {(sup || tech) && (
        <Section title={t.repairTitle} empty={t.noneRepair} count={by("in_repair").length + by("awaiting_parts").length}>
          {by("in_repair").map((j) => <RepairRow key={j.id} {...p} j={j} technician={tech} />)}
          {by("awaiting_parts").map((j) => (
            <div key={j.id} className="border-t border-stone-100 pt-3 flex flex-wrap items-center gap-3">
              <JobHead d={d} j={j} />
              <span className="rounded-full bg-amber-100 text-amber-900 px-2.5 py-1 text-xs">{d.status.awaiting_parts}</span>
              <span className="flex-1" />
              {sup && <button disabled={busy} className={ghost} onClick={() => run(() => moveTicket(j.id, "resume", ""))}>{t.partsArrived}</button>}
            </div>
          ))}
        </Section>
      )}

      {(sup || tech) && (
        <Section title={t.qcTitle} note={sup ? t.qcNote : undefined} empty={t.noneQc} count={by("quality_check").length}>
          {by("quality_check").map((j) => <QcRow key={j.id} {...p} j={j} supervisor={sup} />)}
        </Section>
      )}
    </div>
  );
}

function Section({ title, note, empty, count, children }: { title: string; note?: string; empty?: string; count: number; children: React.ReactNode }) {
  return (
    <section className={card}>
      <div>
        <h2 className="text-lg font-semibold">{title} <span className="text-sm font-normal text-stone-500">({count})</span></h2>
        {note && <p className="text-sm text-stone-600 mt-1">{note}</p>}
      </div>
      {count === 0 && empty && <p className="text-sm text-stone-600">{empty}</p>}
      {children}
    </section>
  );
}

function JobHead({ d, j }: { d: D; j: Job }) {
  const cat = d.diag;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <a href={`/tickets/${j.id}`} className="font-semibold hover:underline" dir="ltr">{j.ticketNo}</a>
        <span>{j.itemName}</span>
        {j.itemCode && <span className="text-xs text-stone-500" dir="ltr">{j.itemCode}</span>}
      </div>
      <div className="text-xs text-stone-600 flex flex-wrap gap-x-3">
        <span>{j.branchName}</span>
        <span>{cat.reported}: {j.fault}{j.faultNotes ? ` — ${j.faultNotes}` : ""}</span>
        <span>{cat.provisional}: {d.warranty[j.provisional as keyof D["warranty"]]}{j.noInvoice ? ` · ${cat.noInvoice}` : ""}</span>
        {j.technician && <span>{d.roles.technician}: {j.technician}</span>}
      </div>
    </div>
  );
}

type RowProps = { d: D; t: D["diag"]; busy: boolean; run: Run; j: Job };

function AssignRow({ d, t, busy, run, j, technicians }: RowProps & { technicians: { id: string; name: string }[] }) {
  const [tech, setTech] = useState(technicians[0]?.id ?? "");
  return (
    <div className="border-t border-stone-100 pt-3 flex flex-wrap items-end gap-3">
      <div className="flex-[1_1_280px]"><JobHead d={d} j={j} /></div>
      <select value={tech} onChange={(e) => setTech(e.target.value)} aria-label={d.roles.technician} className={input}>
        {technicians.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
      <button disabled={busy || !tech} className={primary} onClick={() => run(() => startDiagnosis(j.id, tech))}>{t.assign}</button>
    </div>
  );
}

type Line = { desc: string; qty: string; price: string };

function DiagnoseForm({ d, t, busy, run, j, supervisor, costs }: RowProps & { supervisor: boolean; costs: { name: string; price: number }[] }) {
  const [open, setOpen] = useState(false);
  const [fault, setFault] = useState(j.finding ?? "");
  const [cause, setCause] = useState("");
  const [warranty, setWarranty] = useState<"under_warranty" | "out_of_warranty" | "">(
    j.provisional === "pending_assessment" ? "" : (j.provisional as "under_warranty" | "out_of_warranty"));
  const [exclusion, setExclusion] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<Line[]>([{ desc: "", qty: "1", price: "" }]);
  const [unrep, setUnrep] = useState("");

  const isOverride = j.provisional !== "pending_assessment" && warranty !== "" && warranty !== j.provisional;
  const out = warranty === "out_of_warranty";
  const parsed = lines.filter((l) => l.desc.trim()).map((l) => ({ desc: l.desc.trim(), qty: Number(l.qty) || 0, price: Number(l.price) || 0 }));
  const subtotal = parsed.reduce((s, l) => s + l.qty * l.price, 0);
  const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ok = fault.trim() && warranty && (!isOverride || reason.trim()) && (!out || parsed.length > 0);
  const setLine = (i: number, k: keyof Line, v: string) => setLines(lines.map((l, n) => (n === i ? { ...l, [k]: v } : l)));

  if (!open) {
    return (
      <div className="border-t border-stone-100 pt-3 flex flex-wrap items-center gap-3">
        <div className="flex-[1_1_280px]"><JobHead d={d} j={j} /></div>
        <button className={primary} onClick={() => setOpen(true)}>{t.open}</button>
      </div>
    );
  }

  return (
    <div className="border-t border-stone-100 pt-3 flex flex-col gap-3">
      <JobHead d={d} j={j} />
      <label className="flex flex-col gap-1.5 text-sm font-medium">{t.fault}
        <textarea value={fault} onChange={(e) => setFault(e.target.value)} rows={2} className={input} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">{t.cause}
        <input value={cause} onChange={(e) => setCause(e.target.value)} className={input} />
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium mb-1">{t.warrantyResult}</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {(["under_warranty", "out_of_warranty"] as const).map((w) => (
            <label key={w} className="flex items-center gap-2">
              <input type="radio" name={`w-${j.id}`} checked={warranty === w} onChange={() => setWarranty(w)} /> {d.warranty[w]}
            </label>
          ))}
        </div>
      </fieldset>
      {out && (
        <label className="flex flex-col gap-1.5 text-sm font-medium self-start">{t.exclusion}
          <select value={exclusion} onChange={(e) => setExclusion(e.target.value)} className={input}>
            <option value="">—</option>
            {Object.entries(t.exclusions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      )}
      {isOverride && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 flex flex-col gap-2">
          <p className="text-sm">{t.overrideWarn}</p>
          <label className="flex flex-col gap-1.5 text-sm font-medium">{t.reason}
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={input} />
          </label>
        </div>
      )}
      {out && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t.quote}</span>
          {!!costs.length && (
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs text-stone-600">{t.costs.pick}</span>
              {costs.map((c) => (
                <button key={c.name} type="button" className="rounded-full border border-stone-300 px-3 py-1 text-xs hover:bg-stone-50"
                  onClick={() => setLines([...lines.filter((l) => l.desc.trim()), { desc: c.name, qty: "1", price: String(c.price) }])}>
                  + {c.name} <span dir="ltr">({money(c.price)})</span>
                </button>
              ))}
            </div>
          )}
          {lines.map((l, i) => (
            <div key={i} className="flex flex-wrap gap-2">
              <input value={l.desc} onChange={(e) => setLine(i, "desc", e.target.value)} placeholder={t.lineDesc} aria-label={t.lineDesc} className={`${input} flex-[1_1_220px]`} />
              <input value={l.qty} onChange={(e) => setLine(i, "qty", e.target.value)} inputMode="decimal" aria-label={t.qty} className={`${input} w-20`} dir="ltr" />
              <input value={l.price} onChange={(e) => setLine(i, "price", e.target.value)} inputMode="decimal" placeholder={t.price} aria-label={t.price} className={`${input} w-32`} dir="ltr" />
              {lines.length > 1 && <button className="text-xs text-red-800" onClick={() => setLines(lines.filter((_, n) => n !== i))}>{t.removeLine}</button>}
            </div>
          ))}
          <button className="self-start text-sm underline" onClick={() => setLines([...lines, { desc: "", qty: "1", price: "" }])}>{t.addLine}</button>
          <p className="text-sm text-stone-700">{t.totals(money(subtotal), money(subtotal * VAT), money(subtotal * (1 + VAT)))}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2 items-center">
        <button disabled={busy || !ok} className={primary}
          onClick={() => run(() => submitDiagnosis({
            ticketId: j.id, fault, rootCause: cause, warranty: warranty as "under_warranty" | "out_of_warranty",
            exclusion, overrideReason: reason, quote: parsed,
          }))}>
          {isOverride ? t.submitOverride : out ? t.submitQuote : t.submitRepair}
        </button>
        <button className={ghost} onClick={() => setOpen(false)}>{t.cancel}</button>
      </div>
      {supervisor && (
        <div className="flex flex-wrap gap-2 items-end border-t border-stone-100 pt-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium flex-[1_1_260px]">{t.unrepReason}
            <input value={unrep} onChange={(e) => setUnrep(e.target.value)} className={input} />
          </label>
          <button disabled={busy || !unrep.trim()} className={danger} onClick={() => run(() => moveTicket(j.id, "unrepairable", unrep))}>{t.unrepairable}</button>
        </div>
      )}
    </div>
  );
}

function RepairRow({ d, t, busy, run, j, technician }: RowProps & { technician: boolean }) {
  const [parts, setParts] = useState<{ code: string; qty: string }[]>([]);
  const [waitReason, setWaitReason] = useState("");
  const set = (i: number, k: "code" | "qty", v: string) => setParts(parts.map((p, n) => (n === i ? { ...p, [k]: v } : p)));
  const clean = parts.filter((p) => p.code.trim()).map((p) => ({ code: p.code.trim(), qty: Number(p.qty) || 0 }));

  return (
    <div className="border-t border-stone-100 pt-3 flex flex-col gap-3">
      <JobHead d={d} j={j} />
      {!technician ? <span className="text-xs text-stone-500">{d.status.in_repair}</span> : (
        <>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t.parts}</span>
            {parts.map((p, i) => (
              <div key={i} className="flex gap-2">
                <input value={p.code} onChange={(e) => set(i, "code", e.target.value)} placeholder={t.partCode} aria-label={t.partCode} dir="ltr" className={`${input} w-52`} />
                <input value={p.qty} onChange={(e) => set(i, "qty", e.target.value)} inputMode="decimal" aria-label={t.qty} dir="ltr" className={`${input} w-20`} />
                <button className="text-xs text-red-800" onClick={() => setParts(parts.filter((_, n) => n !== i))}>{t.removeLine}</button>
              </div>
            ))}
            <button className="self-start text-sm underline" onClick={() => setParts([...parts, { code: "", qty: "1" }])}>{t.addPart}</button>
          </div>
          <div className="flex flex-wrap gap-2 items-end">
            <button disabled={busy || clean.some((p) => p.qty <= 0)} className={primary} onClick={() => run(() => completeRepair(j.id, clean), () => setParts([]))}>{t.complete}</button>
            <input value={waitReason} onChange={(e) => setWaitReason(e.target.value)} placeholder={t.partsReason} aria-label={t.partsReason} className={`${input} flex-[1_1_220px]`} />
            <button disabled={busy || !waitReason.trim()} className={ghost} onClick={() => run(() => moveTicket(j.id, "awaiting_parts", waitReason))}>{t.waitParts}</button>
          </div>
        </>
      )}
    </div>
  );
}

function QcRow({ d, t, busy, run, j, supervisor }: RowProps & { supervisor: boolean }) {
  const [reason, setReason] = useState("");
  return (
    <div className="border-t border-stone-100 pt-3 flex flex-wrap items-end gap-3">
      <div className="flex-[1_1_280px]"><JobHead d={d} j={j} /></div>
      {supervisor ? (
        <>
          <button disabled={busy} className={primary} onClick={() => run(() => moveTicket(j.id, "qc_pass", ""))}>{t.qcPass}</button>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.qcFailReason} aria-label={t.qcFailReason} className={`${input} w-56`} />
          <button disabled={busy || !reason.trim()} className={danger} onClick={() => run(() => moveTicket(j.id, "qc_fail", reason))}>{t.qcFail}</button>
        </>
      ) : <span className="text-xs text-stone-500">{t.waitingQc}</span>}
    </div>
  );
}
