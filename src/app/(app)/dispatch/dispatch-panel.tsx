"use client";

import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import type { AppRole } from "@/lib/auth";
import { approveBatch, courierPickup, createOutbound, createReturn, receiveBatch } from "./actions";

export type ItemRow = { id: string; ticketNo: string; itemName: string; branchId: string; branchName: string };
export type BatchRow = {
  id: string; batchNo: string; direction: "outbound" | "return"; branchName: string; seal: string;
  status: string; mine: boolean; createdAt: string; pickedAt: string | null;
  items: { ticketNo: string; itemName: string; scanned: boolean }[];
};
type T = (typeof dictionaries)["en"]["dispatch"];
type Run = (fn: () => Promise<{ error?: string; batchNo?: string }>, after?: () => void) => void;

const card = "bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4";
const input = "rounded-lg border border-stone-300 px-3 py-2.5 text-sm focus:outline-2 focus:outline-stone-900";
const primary = "self-start rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-5 py-2.5 text-sm font-semibold disabled:opacity-40";
const BADGE: Record<string, string> = {
  awaiting_approval: "bg-stone-100 text-stone-800",
  in_transit: "bg-amber-100 text-amber-900",
  received: "bg-emerald-100 text-emerald-900",
  incident: "bg-red-100 text-red-900",
};

export function DispatchPanel({ locale, role, myBranches, packable, returnable, batches }: {
  locale: Locale; role: AppRole; myBranches: { id: string; name: string }[];
  packable: ItemRow[]; returnable: ItemRow[]; batches: BatchRow[];
}) {
  const t = dictionaries[locale].dispatch;
  const [busy, start] = useTransition();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const isBranch = role === "associate" || role === "manager";

  const run: Run = (fn, after) =>
    start(async () => {
      setError(""); setNotice("");
      const r = await fn();
      if (r.error) { setError(t.errors[r.error] ?? t.errors.failed); return; }
      toast();
      if (r.batchNo) setNotice(t.created(r.batchNo));
      after?.();
    });

  const awaiting = batches.filter((b) => b.direction === "outbound" && b.status === "awaiting_approval");
  const incoming = batches.filter((b) => b.status === "in_transit" &&
    ((role === "hq" && b.direction === "outbound") || (isBranch && b.direction === "return")));
  const fmt = (s: string) => new Date(s).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "short", timeStyle: "short" });

  // Return items grouped by destination branch
  const returnGroups = [...new Set(returnable.map((i) => i.branchId))].map((id) => returnable.filter((i) => i.branchId === id));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{t.title}</h1>
      {error && <p role="alert" className="rounded-lg bg-red-50 text-red-800 text-sm p-3">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 text-emerald-900 text-sm p-3">{notice}</p>}

      {isBranch && (
        <PackCard t={t} title={t.packTitle} note={t.packNote} empty={t.noneToPack} busy={busy} run={run}
          branches={myBranches} items={packable} onCreate={(branchId, seal, ids) => createOutbound({ branchId, seal, ticketIds: ids })} />
      )}

      {role === "supervisor" && (
        <section className={card}>
          <div>
            <h2 className="text-lg font-semibold">{t.returnTitle}</h2>
            <p className="text-sm text-stone-600 mt-1">{t.returnNote}</p>
          </div>
          {!returnGroups.length && <p className="text-sm text-stone-600">{t.noneToReturn}</p>}
          {returnGroups.map((g) => (
            <PackCard key={g[0].branchId} t={t} nested title={g[0].branchName} busy={busy} run={run}
              branches={[{ id: g[0].branchId, name: g[0].branchName }]} items={g}
              onCreate={(branchId, seal, ids) => createReturn({ branchId, seal, ticketIds: ids })} />
          ))}
        </section>
      )}

      {(isBranch || role === "courier") && awaiting.length > 0 && (
        <section className={card}>
          <h2 className="text-lg font-semibold">{t.approvalTitle}</h2>
          {awaiting.map((b) => (
            <div key={b.id} className="border-t border-stone-100 pt-3 flex flex-wrap items-center gap-3">
              <BatchHead t={t} b={b} />
              <span className="flex-1" />
              {role === "manager" && (b.mine
                ? <span className="text-xs text-stone-500">{t.ownBatch}</span>
                : <button disabled={busy} className={primary} onClick={() => run(() => approveBatch(b.id))}>{t.approve}</button>)}
              <ItemList items={b.items} />
            </div>
          ))}
        </section>
      )}

      {role === "courier" && (
        <section className={card}>
          <div>
            <h2 className="text-lg font-semibold">{t.collectTitle}</h2>
            <p className="text-sm text-stone-600 mt-1">{t.collectNote}</p>
          </div>
          {!batches.some((b) => b.status === "in_transit" && !b.pickedAt) && <p className="text-sm text-stone-600">{t.noneToCollect}</p>}
          {batches.filter((b) => b.status === "in_transit" && !b.pickedAt).map((b) => <CollectCard key={b.id} t={t} b={b} busy={busy} run={run} />)}
        </section>
      )}

      {(role === "hq" || isBranch) && (
        <section className={card}>
          <div>
            <h2 className="text-lg font-semibold">{t.incomingTitle}</h2>
            <p className="text-sm text-stone-600 mt-1">{t.incomingNote}</p>
          </div>
          {!incoming.length && <p className="text-sm text-stone-600">{t.noneIncoming}</p>}
          {incoming.map((b) => <ReceiveCard key={b.id} t={t} b={b} busy={busy} run={run} />)}
        </section>
      )}

      <section className={card}>
        <h2 className="text-lg font-semibold">{t.recentTitle}</h2>
        {!batches.length ? <p className="text-sm text-stone-600">{t.noneRecent}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-xs text-stone-500">
                  {Object.values(t.cols).map((c) => <th key={c} className="p-2 text-start font-medium">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="border-t border-stone-100">
                    <td className="p-2 font-semibold" dir="ltr">{b.batchNo}</td>
                    <td className="p-2">{b.direction === "outbound" ? t.outbound : t.return}</td>
                    <td className="p-2">{b.branchName}</td>
                    <td className="p-2" dir="ltr">{b.seal}</td>
                    <td className="p-2">{b.items.filter((i) => i.scanned).length}/{b.items.length}</td>
                    <td className="p-2">{fmt(b.createdAt)}</td>
                    <td className="p-2"><span className={`rounded-full px-2.5 py-1 text-xs whitespace-nowrap ${BADGE[b.status]}`}>{t.batchStatus[b.status]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function PackCard({ t, title, note, empty, nested, busy, run, branches, items, onCreate }: {
  t: T; title: string; note?: string; empty?: string; nested?: boolean; busy: boolean; run: Run;
  branches: { id: string; name: string }[]; items: ItemRow[];
  onCreate: (branchId: string, seal: string, ids: string[]) => Promise<{ error?: string; batchNo?: string }>;
}) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [picked, setPicked] = useState<string[]>([]);
  const [seal, setSeal] = useState("");
  const shown = items.filter((i) => i.branchId === branchId);
  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const chosen = picked.filter((id) => shown.some((i) => i.id === id));

  return (
    <section className={nested ? "border-t border-stone-200 pt-4 flex flex-col gap-3" : card}>
      <div>
        <h2 className={nested ? "font-semibold" : "text-lg font-semibold"}>{title}</h2>
        {note && <p className="text-sm text-stone-600 mt-1">{note}</p>}
      </div>
      {branches.length > 1 && (
        <label className="flex flex-col gap-1.5 text-sm font-medium self-start">{t.branch}
          <select value={branchId} onChange={(e) => { setBranchId(e.target.value); setPicked([]); }} className={input}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      )}
      {!shown.length ? <p className="text-sm text-stone-600">{empty}</p> : (
        <>
          <div className="flex flex-col">
            {shown.map((i) => (
              <label key={i.id} className="flex items-center gap-3 border-t border-stone-100 py-2 text-sm">
                <input type="checkbox" checked={picked.includes(i.id)} onChange={() => toggle(i.id)} />
                <strong dir="ltr">{i.ticketNo}</strong>
                <span className="text-stone-700">{i.itemName}</span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium">{t.seal}
              <input value={seal} onChange={(e) => setSeal(e.target.value)} dir="ltr" className={`${input} w-48`} />
            </label>
            <button disabled={busy || !chosen.length || !seal.trim()} className={primary}
              onClick={() => run(() => onCreate(branchId, seal, chosen), () => { setPicked([]); setSeal(""); })}>
              {t.create(chosen.length)}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function ReceiveCard({ t, b, busy, run }: { t: T; b: BatchRow; busy: boolean; run: Run }) {
  const [scanned, setScanned] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [warn, setWarn] = useState("");
  const inBatch = new Set(b.items.map((i) => i.ticketNo.toUpperCase()));

  const add = () => {
    const c = code.trim().toUpperCase();
    if (!c) return;
    if (!inBatch.has(c)) setWarn(t.unknown(c));
    else { setWarn(""); if (!scanned.includes(c)) setScanned([...scanned, c]); }
    setCode("");
  };
  const missing = b.items.length - scanned.length;

  return (
    <div className="border-t border-stone-100 pt-3 flex flex-col gap-3">
      <BatchHead t={t} b={b} />
      <div className="flex flex-col">
        {b.items.map((i) => {
          const ok = scanned.includes(i.ticketNo.toUpperCase());
          return (
            <div key={i.ticketNo} className="flex items-center gap-3 py-1.5 text-sm">
              <span aria-hidden className={`w-5 h-5 rounded-full grid place-items-center text-xs ${ok ? "bg-emerald-600 text-white" : "bg-stone-200"}`}>{ok ? "✓" : ""}</span>
              <strong dir="ltr">{i.ticketNo}</strong>
              <span className="text-stone-700">{i.itemName}</span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">{t.scan}
          <input value={code} onChange={(e) => setCode(e.target.value)} dir="ltr" placeholder="MT-1001"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} className={`${input} w-52`} />
        </label>
        <button onClick={add} className="rounded-lg border border-stone-900 px-4 py-2.5 text-sm">{t.add}</button>
      </div>
      {warn && <p className="text-sm text-red-800">{warn}</p>}
      {missing > 0 && scanned.length > 0 && <p className="text-sm text-amber-800">{t.missingWarn(missing)}</p>}
      {b.mine ? <p className="text-xs text-stone-500">{t.errors.sod}</p> : (
        <button disabled={busy || !scanned.length} className={primary} onClick={() => run(() => receiveBatch(b.id, scanned))}>
          {t.receive(scanned.length, b.items.length)}
        </button>
      )}
    </div>
  );
}

function BatchHead({ t, b }: { t: T; b: BatchRow }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <strong dir="ltr">{b.batchNo}</strong>
      <span className="text-sm text-stone-600">{b.direction === "outbound" ? t.outbound : t.return} · {b.branchName}</span>
      <span className="text-xs text-stone-500">{t.seal}: <span dir="ltr">{b.seal}</span> · {t.items}: {b.items.length}</span>
      {b.pickedAt && <span className="text-xs text-emerald-800">{t.collected(new Date(b.pickedAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }))}</span>}
    </div>
  );
}

function ItemList({ items }: { items: BatchRow["items"] }) {
  return (
    <ul className="w-full text-sm text-stone-700 flex flex-wrap gap-x-4 gap-y-1">
      {items.map((i) => <li key={i.ticketNo}><span dir="ltr" className="font-medium">{i.ticketNo}</span> {i.itemName}</li>)}
    </ul>
  );
}

// Courier: type the seal number written on the bag to confirm collecting it
function CollectCard({ t, b, busy, run }: { t: T; b: BatchRow; busy: boolean; run: Run }) {
  const [seal, setSeal] = useState("");
  return (
    <div className="border-t border-stone-100 pt-3 flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-56">
        <strong dir="ltr">{b.batchNo}</strong>
        <div className="text-sm text-stone-600">{b.direction === "outbound" ? t.outbound : t.return} · {b.branchName} · {t.items}: {b.items.length}</div>
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium">{t.sealOnBag}
        <input value={seal} onChange={(e) => setSeal(e.target.value)} dir="ltr" className={`${input} w-40`} />
      </label>
      <button disabled={busy || !seal.trim()} className={primary} onClick={() => run(() => courierPickup(b.id, seal))}>{t.collect}</button>
    </div>
  );
}
