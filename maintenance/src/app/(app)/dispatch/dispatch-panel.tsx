"use client";

import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { BarcodeScan } from "@/components/barcode-scan";
import { useAsk } from "@/components/ask";
import { withBase } from "@/lib/base";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import type { AppRole } from "@/lib/auth";
import { adminApproveBatch, approveBatch, courierPickup, createOutbound, createReturn, markItemLost, receiveBatch, receiveLateItem } from "./actions";

export type ItemRow = { id: string; ticketNo: string; itemName: string; branchId: string; branchName: string; pickup?: "courier" | "area_manager" | null };
export type BatchRow = {
  id: string; batchNo: string; direction: "outbound" | "return"; branchId: string; branchName: string; seal: string;
  status: string; picker: "courier" | "delivery"; mine: boolean; createdAt: string; pickedAt: string | null;
  items: { ticketNo: string; itemName: string; scanned: boolean; pending?: boolean }[];
};
type T = (typeof dictionaries)["en"]["dispatch"];
type Run = (fn: () => Promise<{ error?: string; batchNo?: string; awb?: string; batchId?: string }>, after?: () => void) => void;

const card = "bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4";
const input = "rounded-lg border border-stone-300 px-3 py-2.5 text-sm focus:outline-2 focus:outline-stone-900";
const primary = "self-start rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-5 py-2.5 text-sm font-semibold disabled:opacity-40";
const BADGE: Record<string, string> = {
  awaiting_approval: "bg-stone-100 text-stone-800",
  in_transit: "bg-amber-100 text-amber-900",
  received: "bg-emerald-100 text-emerald-900",
  incident: "bg-red-100 text-red-900",
};

export function DispatchPanel({ locale, role, myBranches, packable: allPackable, returnable: allReturnable, batches: allBatches, areaManager = true, isAdmin = false }: {
  locale: Locale; role: AppRole; myBranches: { id: string; name: string }[];
  packable: ItemRow[]; returnable: ItemRow[]; batches: BatchRow[]; areaManager?: boolean; isAdmin?: boolean;
}) {
  const t = dictionaries[locale].dispatch;
  const [busy, start] = useTransition();
  const [ask, askDialog] = useAsk();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [printId, setPrintId] = useState(""); // the bag just created: print its AWB label
  const [picked, setPicked] = useState<string[]>([]); // batches ticked for approval
  // Store filter: "all" or one store; every section below shows only that store
  const [store, setStore] = useState("all");
  const inStore = <R extends { branchId: string }>(rows: R[]) => (store === "all" ? rows : rows.filter((r) => r.branchId === store));
  const packable = inStore(allPackable), returnable = inStore(allReturnable), batches = inStore(allBatches);
  const packBranches = store === "all" ? myBranches : myBranches.filter((b) => b.id === store);
  const isBranch = role === "associate" || role === "manager";

  const run: Run = (fn, after) =>
    start(async () => {
      setError(""); setNotice(""); setPrintId("");
      const r = await fn();
      if (r.error) { setError(t.errors[r.error] ?? t.errors.failed); return; }
      toast();
      if (r.batchNo) setNotice(t.created(r.batchNo, r.awb ?? ""));
      if (r.batchId) { setPrintId(r.batchId); window.open(withBase(`/awb/${r.batchId}`), "_blank", "noopener"); }
      after?.();
    });

  const awaiting = batches.filter((b) => b.direction === "outbound" && b.status === "awaiting_approval");
  const incoming = batches.filter((b) => b.status === "in_transit" &&
    ((["hq", "technician", "supervisor"].includes(role) && b.direction === "outbound") || (isBranch && b.direction === "return")));
  const fmt = (s: string) => new Date(s).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "short", timeStyle: "short" });

  // Return items grouped by destination branch
  const returnGroups = [...new Set(returnable.map((i) => i.branchId))].map((id) => returnable.filter((i) => i.branchId === id));

  return (
    <div className="flex flex-col gap-6">
      {askDialog}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t.title}</h1>
        {myBranches.length > 1 && (
          <label className="flex items-center gap-2 text-sm font-medium">{t.storeFilter}
            <select value={store} onChange={(e) => { setStore(e.target.value); setPicked([]); }}
              className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-normal bg-white">
              <option value="all">{t.allStores}</option>
              {myBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        )}
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 text-red-800 text-sm p-3">{error}</p>}
      {notice && (
        <p role="status" className="rounded-lg bg-emerald-50 text-emerald-900 text-sm p-3 flex flex-wrap items-center gap-3">
          <span>{notice}</span>
          {printId && <a href={withBase(`/awb/${printId}`)} target="_blank" rel="noopener" className="rounded-lg border border-emerald-800 px-3 py-1 text-xs font-semibold">{t.printAwb}</a>}
        </p>
      )}

      {isBranch && (
        <PackCard key={store} t={t} title={t.packTitle} note={t.packNote} empty={t.noneToPack} busy={busy} run={run}
          branches={packBranches} items={packable} onCreate={(branchId, seal, ids, pickup) => createOutbound({ branchId, seal, ticketIds: ids, pickup })} />
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
              onCreate={(branchId, seal, ids, pickup) => createReturn({ branchId, seal, ticketIds: ids, pickup })} />
          ))}
        </section>
      )}

      {(isBranch || role === "courier") && awaiting.length > 0 && (
        <section className={card}>
          <h2 className="text-lg font-semibold">{t.approvalTitle}</h2>
          {awaiting.map((b) => {
            const can = role === "manager" && !b.mine;
            return (
              <label key={b.id} className={`border-t border-stone-100 pt-3 flex flex-wrap items-center gap-3 ${can ? "cursor-pointer" : ""}`}>
                {can && <input type="checkbox" className="h-5 w-5" checked={picked.includes(b.id)}
                  onChange={(e) => setPicked(e.target.checked ? [...picked, b.id] : picked.filter((x) => x !== b.id))} />}
                <BatchHead t={t} b={b} />
                <span className="flex-1" />
                {role === "manager" && b.mine && <span className="text-xs text-stone-500">{t.ownBatch}</span>}
                {isAdmin && b.mine && (
                  <button type="button" disabled={busy} className="text-xs font-semibold underline"
                    onClick={async (e) => { e.preventDefault(); const why = await ask({ title: t.adminApprove, message: t.adminApproveReason, input: true, confirmLabel: t.adminApprove, cancelLabel: t.cancel }); if (why?.trim()) run(() => adminApproveBatch(b.id, why)); }}>
                    {t.adminApprove}
                  </button>
                )}
                <ItemList items={b.items} />
              </label>
            );
          })}
          {role === "manager" && awaiting.some((b) => !b.mine) && (
            <div className="border-t border-stone-100 pt-3">
              <button disabled={busy || !picked.length} className={`${primary} disabled:opacity-40`}
                onClick={() => run(async () => {
                  for (const id of picked) { const r = await approveBatch(id); if (r.error) return r; }
                  return {};
                }, () => setPicked([]))}>
                {t.approveSelected(picked.length)}
              </button>
            </div>
          )}
        </section>
      )}

      {(role === "courier" || role === "delivery") && (
        <section className={card}>
          <div>
            <h2 className="text-lg font-semibold">{t.collectTitle}</h2>
            <p className="text-sm text-stone-600 mt-1">{t.collectNote}</p>
          </div>
          {(() => {
            // Only the trips this role picks up; on the other trips the Area Manager just follows the bags below
            const mine = batches.filter((b) => b.status === "in_transit" && !b.pickedAt && b.picker === role);
            return mine.length ? mine.map((b) => <CollectCard key={b.id} t={t} b={b} busy={busy} run={run} />) : <p className="text-sm text-stone-600">{t.noneToCollect}</p>;
          })()}
        </section>
      )}

      {(["hq", "technician", "supervisor"].includes(role) || isBranch) && (
        <section className={card}>
          <div>
            <h2 className="text-lg font-semibold">{t.incomingTitle}</h2>
            <p className="text-sm text-stone-600 mt-1">{t.incomingNote}</p>
          </div>
          {!incoming.length && <p className="text-sm text-stone-600">{t.noneIncoming}</p>}
          <BulkReceive t={t} busy={busy} run={run}
            batches={incoming.filter((b) => !(areaManager && !b.pickedAt) && (!b.mine || isAdmin))} />
          {incoming.map((b) => <ReceiveCard key={b.id} t={t} b={b} busy={busy} run={run} areaManager={areaManager} isAdmin={isAdmin} />)}
        </section>
      )}

      {(() => {
        // Bags that arrived short: receivers scan late items, Ops confirms lost ones
        const canReceive = (b: BatchRow) => isAdmin || (b.direction === "outbound" ? ["hq", "technician", "supervisor"].includes(role) : isBranch);
        const canLose = isAdmin || role === "ops";
        const open = batches.filter((b) => b.status === "incident" && b.items.some((i) => i.pending) && (canReceive(b) || canLose));
        if (!open.length) return null;
        return (
          <section className={card}>
            <div>
              <h2 className="text-lg font-semibold">{t.incidentTitle}</h2>
              <p className="text-sm text-stone-600 mt-1">{t.incidentNote}</p>
            </div>
            {open.map((b) => <IncidentCard key={b.id} t={t} b={b} busy={busy} run={run} receive={canReceive(b)} lose={canLose} />)}
          </section>
        );
      })()}

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
                    <td className="p-2" dir="ltr"><a href={withBase(`/awb/${b.id}`)} target="_blank" rel="noopener" className="underline" title={t.printAwb}>{b.seal}</a></td>
                    <td className="p-2">{b.items.filter((i) => i.scanned).length}/{b.items.length}</td>
                    <td className="p-2">{fmt(b.createdAt)}</td>
                    <td className="p-2"><span className={`rounded-full px-2.5 py-1 text-xs whitespace-nowrap ${BADGE[b.status]}`}>{t.batchStatus[b.status]}</span>{waitingOn(t, b) && <div className="text-[11px] text-stone-500 mt-1 whitespace-nowrap">{t.waitingOn}: {waitingOn(t, b)}</div>}</td>
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
  onCreate: (branchId: string, seal: string, ids: string[], pickup?: "courier" | "area_manager") => Promise<{ error?: string; batchNo?: string; awb?: string; batchId?: string }>;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [pickup, setPickup] = useState<"courier" | "area_manager" | "">(""); // "" = the store's default
  // "All stores": every store's items are listed; one bag holds one store, taken from the ticked items
  const many = branches.length > 1;
  const shown = items.filter((i) => branches.some((b) => b.id === i.branchId));
  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const chosen = picked.filter((id) => shown.some((i) => i.id === id));
  const chosenStores = [...new Set(shown.filter((i) => chosen.includes(i.id)).map((i) => i.branchId))];
  const branchId = chosenStores.length === 1 ? chosenStores[0] : branches[0]?.id ?? "";
  const mixed = chosenStores.length > 1;

  return (
    <section className={nested ? "border-t border-stone-200 pt-4 flex flex-col gap-3" : card}>
      <div>
        <h2 className={nested ? "font-semibold" : "text-lg font-semibold"}>{title}</h2>
        {note && <p className="text-sm text-stone-600 mt-1">{note}</p>}
      </div>
      {!shown.length ? <p className="text-sm text-stone-600">{empty}</p> : (
        <>
          <div className="flex flex-col">
            {shown.map((i) => (
              <label key={i.id} className="flex items-center gap-3 border-t border-stone-100 py-2 text-sm">
                <input type="checkbox" checked={picked.includes(i.id)} onChange={() => toggle(i.id)} />
                <strong dir="ltr">{i.ticketNo}</strong>
                <span className="text-stone-700">{i.itemName}</span>
                {many && <span className="text-stone-500">· {i.branchName}</span>}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <p className="text-sm text-stone-600 basis-full">{t.awbAuto}</p>
            {mixed && <p className="text-sm text-amber-800 basis-full">{t.oneStore}</p>}
            {(() => {
              // Who picks this bag up: the Courier takes it sealed (AWB only), the Area Manager checks every item first
              const def = shown.find((i) => i.branchId === branchId)?.pickup;
              if (!def) return null;
              const cur = pickup || def;
              return (
                <fieldset className="basis-full flex flex-col gap-2">
                  <legend className="text-sm font-medium mb-1">{t.pickupTitle}</legend>
                  {(["courier", "area_manager"] as const).map((k) => (
                    <label key={k} className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm cursor-pointer ${cur === k ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-stone-200"}`}>
                      <input type="radio" name={`pickup-${title}`} checked={cur === k} onChange={() => setPickup(k)} className="mt-0.5" />
                      <span><b>{k === "courier" ? t.pickupCourier : t.pickupAreaManager}</b><span className="block text-xs text-stone-600">{k === "courier" ? t.pickupCourierNote : t.pickupAreaManagerNote}</span></span>
                    </label>
                  ))}
                </fieldset>
              );
            })()}
            <button disabled={busy || !chosen.length || mixed} className={primary}
              onClick={() => run(() => onCreate(branchId, "", chosen, pickup || undefined), () => { setPicked([]); setPickup(""); })}>
              {t.create(chosen.length)}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// Scan every item in a batch: typed, a barcode scanner (types + Enter) or the camera
function useItemScan(t: T, b: BatchRow) {
  const [scanned, setScanned] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [warn, setWarn] = useState("");
  const inBatch = new Set(b.items.map((i) => i.ticketNo.toUpperCase()));
  const add = (raw = code) => {
    const c = raw.trim().toUpperCase();
    if (!c) return;
    if (!inBatch.has(c)) setWarn(t.unknown(c));
    else { setWarn(""); setScanned((s) => (s.includes(c) ? s : [...s, c])); }
    setCode("");
  };
  const ui = (
    <>
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
        <button onClick={() => add()} className="rounded-lg border border-stone-900 px-4 py-2.5 text-sm">{t.add}</button>
        <BarcodeScan label={t.camera} title={t.scan} cancel={t.cancel} denied={t.cameraDenied} onResult={(c) => add(c)} />
      </div>
      {warn && <p className="text-sm text-red-800">{warn}</p>}
    </>
  );
  return { scanned, ui, missing: b.items.length - scanned.length };
}

function ReceiveCard({ t, b, busy, run, areaManager, isAdmin }: { t: T; b: BatchRow; busy: boolean; run: Run; areaManager: boolean; isAdmin: boolean }) {
  const { scanned, ui, missing } = useItemScan(t, b);
  return (
    <div className="border-t border-stone-100 pt-3 flex flex-col gap-3">
      <BatchHead t={t} b={b} />
      {areaManager && !b.pickedAt ? <p className="text-sm text-amber-800">{t.notCollectedYet}</p> : (
        <>
          {ui}
          {missing > 0 && scanned.length > 0 && <p className="text-sm text-amber-800">{t.missingWarn(missing)}</p>}
          {b.mine && !isAdmin ? <p className="text-xs text-stone-500">{t.errors.sod}</p> : (
            <button disabled={busy || !scanned.length} className={primary} onClick={() => run(() => receiveBatch(b.id, scanned))}>
              {t.receive(scanned.length, b.items.length)}
            </button>
          )}
        </>
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
  const scan = useItemScan(t, b);
  const sealed = b.picker === "delivery"; // the Courier takes the sealed bag: AWB only, no item check
  const { scanned, ui } = scan;
  const missing = sealed ? 0 : scan.missing;
  return (
    <div className="border-t border-stone-100 pt-3 flex flex-col gap-3">
      <div>
        <strong dir="ltr">{b.batchNo}</strong>
        <div className="text-sm text-stone-600">{b.direction === "outbound" ? t.outbound : t.return} · {b.branchName} · {t.items}: {b.items.length}</div>
      </div>
      {sealed ? <p className="text-sm text-stone-600">{t.sealedNote}</p> : ui}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">{t.sealOnBag}
          <input value={seal} onChange={(e) => setSeal(e.target.value)} dir="ltr" placeholder="AWB-…" className={`${input} w-52`} />
        </label>
        <BarcodeScan label={t.camera} title={t.sealOnBag} cancel={t.cancel} denied={t.cameraDenied} onResult={(c) => setSeal(c.trim())} />
        <button disabled={busy || !seal.trim() || missing > 0} className={primary} onClick={() => run(() => courierPickup(b.id, seal, scanned))}>{t.collect}</button>
        {!sealed && <span className="text-sm text-stone-600">{missing > 0 ? t.scanAllFirst(missing) : t.allScanned}</span>}
      </div>
    </div>
  );
}

// Who the batch is waiting on, shown under its status
function waitingOn(t: T, b: BatchRow): string {
  if (b.status === "awaiting_approval") return t.wait.manager;
  if (b.status === "in_transit") return !b.pickedAt ? (b.picker === "delivery" ? t.wait.delivery : t.wait.courier) : b.direction === "outbound" ? t.wait.hq : t.wait.branch;
  if (b.status === "incident") return t.wait.ops;
  return "";
}

// One scan box for every incoming batch: scan all bags' items, then confirm them in one go
function BulkReceive({ t, batches, busy, run }: { t: T; batches: BatchRow[]; busy: boolean; run: Run }) {
  const [scanned, setScanned] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [warn, setWarn] = useState("");
  if (batches.length < 2) return null;
  const owner = new Map(batches.flatMap((b) => b.items.map((i) => [i.ticketNo.toUpperCase(), b.id] as const)));
  const add = (raw = code) => {
    const c = raw.trim().toUpperCase();
    if (!c) return;
    if (!owner.has(c)) setWarn(t.unknown(c));
    else { setWarn(""); setScanned((s) => (s.includes(c) ? s : [...s, c])); }
    setCode("");
  };
  const rows = batches.map((b) => ({ b, got: b.items.filter((i) => scanned.includes(i.ticketNo.toUpperCase())).map((i) => i.ticketNo) }))
    .filter((r) => r.got.length);
  const partial = rows.filter((r) => r.got.length < r.b.items.length).length;
  return (
    <div className="rounded-xl border border-stone-300 bg-stone-50 p-4 flex flex-col gap-3">
      <div>
        <strong>{t.bulkTitle}</strong>
        <p className="text-sm text-stone-600">{t.bulkNote}</p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value)} dir="ltr" placeholder="MT-1001" aria-label={t.scan}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} className={`${input} w-52`} />
        <button onClick={() => add()} className="rounded-lg border border-stone-900 px-4 py-2.5 text-sm">{t.add}</button>
        <BarcodeScan label={t.camera} title={t.scan} cancel={t.cancel} denied={t.cameraDenied} onResult={(c) => add(c)} />
      </div>
      {warn && <p className="text-sm text-red-800">{warn}</p>}
      {rows.map((r) => (
        <div key={r.b.id} className="text-sm"><strong dir="ltr">{r.b.batchNo}</strong> · {r.b.branchName} · {r.got.length}/{r.b.items.length}</div>
      ))}
      {partial > 0 && <p className="text-sm text-amber-800">{t.bulkPartial(partial)}</p>}
      <button disabled={busy || !rows.length} className={`${primary} self-start disabled:opacity-40`}
        onClick={() => run(async () => {
          for (const r of rows) { const x = await receiveBatch(r.b.id, r.got); if (x.error) return x; }
          return {};
        }, () => setScanned([]))}>
        {t.bulkConfirm(rows.length)}
      </button>
    </div>
  );
}


function IncidentCard({ t, b, busy, run, receive, lose }: { t: T; b: BatchRow; busy: boolean; run: Run; receive: boolean; lose: boolean }) {
  const [code, setCode] = useState("");
  const [ask, askDialog] = useAsk();
  const pending = b.items.filter((i) => i.pending);
  const take = (c: string) => { if (c.trim()) run(() => receiveLateItem(b.id, c), () => setCode("")); };
  return (
    <div className="border-t border-stone-100 pt-3 flex flex-col gap-3">
      {askDialog}
      <BatchHead t={t} b={b} />
      <div className="text-sm font-medium">{t.pendingItems}:</div>
      {pending.map((i) => (
        <div key={i.ticketNo} className="flex flex-wrap items-center gap-3 text-sm">
          <strong dir="ltr">{i.ticketNo}</strong>
          <span className="text-stone-700">{i.itemName}</span>
          {lose && (
            <button type="button" disabled={busy} className="text-xs font-semibold text-red-800 underline"
              onClick={async () => { const why = await ask({ title: `${t.markLost} · ${i.ticketNo}`, message: t.lostReason, input: true, confirmLabel: t.markLost, cancelLabel: t.cancel, danger: true }); if (why?.trim()) run(() => markItemLost(b.id, i.ticketNo, why)); }}>
              {t.markLost}
            </button>
          )}
        </div>
      ))}
      {receive && (
        <div className="flex flex-wrap items-end gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value)} dir="ltr" placeholder="MT-1001" aria-label={t.scan}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); take(code); } }} className={`${input} w-52`} />
          <button disabled={busy || !code.trim()} onClick={() => take(code)} className={primary}>{t.receiveLate}</button>
          <BarcodeScan label={t.camera} title={t.scan} cancel={t.cancel} denied={t.cameraDenied} onResult={(c) => take(c)} />
        </div>
      )}
    </div>
  );
}
