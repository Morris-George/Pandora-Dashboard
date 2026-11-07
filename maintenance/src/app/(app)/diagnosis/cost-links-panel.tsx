"use client";

import { useState, useTransition } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { useAsk } from "@/components/ask";
import { addCostLink, removeCostLink, syncCostPrices } from "./actions";

export type CostLink = { id: string; itemCode: string; costCode: string; costName: string; price: number | null; source: string; syncedAt: string | null };

const input = "rounded-lg border border-stone-300 px-3 py-2 text-sm font-normal focus:outline-2 focus:outline-stone-900";

// Super Admin: link a product item code to ERPNext cost items (spare parts / service) with their price
export function CostLinksPanel({ locale, links }: { locale: Locale; links: CostLink[] }) {
  const t = dictionaries[locale].diag.costs;
  const [busy, start] = useTransition();
  const [ask, askDialog] = useAsk();
  const [item, setItem] = useState("");
  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("");
  const [filter, setFilter] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  type R = { error?: string; synced?: number; missing?: number };
  const run = (fn: () => Promise<R>, after?: () => void) => start(async () => {
    setMsg(null);
    const r: R = await fn().catch(() => ({ error: "failed" }));
    if (r.error) { setMsg({ ok: false, text: t.errors[r.error as keyof typeof t.errors] ?? t.errors.failed }); return; }
    if (r.synced !== undefined) setMsg({ ok: true, text: t.synced(r.synced, r.missing ?? 0) });
    after?.();
  });

  const shown = links.filter((l) => !filter.trim() || `${l.itemCode} ${l.costCode} ${l.costName}`.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4">
      {askDialog}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t.title} <span className="text-sm font-normal text-stone-500">({links.length})</span></h2>
          <p className="text-sm text-stone-600 mt-1 max-w-2xl">{t.note}</p>
        </div>
        <button disabled={busy || !links.length} className="rounded-lg border border-stone-900 px-4 py-2 text-sm disabled:opacity-40"
          onClick={() => run(() => syncCostPrices())}>{t.sync}</button>
      </div>

      <div className="flex flex-wrap gap-2 items-end">
        <label className="flex flex-col gap-1 text-sm font-medium">{t.itemCode}
          <input value={item} onChange={(e) => setItem(e.target.value)} dir="ltr" className={`${input} w-44`} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">{t.costCode}
          <input value={cost} onChange={(e) => setCost(e.target.value)} dir="ltr" className={`${input} w-44`} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">{t.manualPrice}
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" dir="ltr" className={`${input} w-32`} />
        </label>
        <button disabled={busy || !item.trim() || !cost.trim()} className="rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-4 py-2 text-sm font-semibold disabled:opacity-40"
          onClick={() => run(() => addCostLink(item, cost, price), () => { setCost(""); setPrice(""); })}>{t.add}</button>
      </div>
      <p className="text-xs text-stone-500">{t.priceNote}</p>
      {msg && <p role="status" className={`rounded-lg text-sm p-3 ${msg.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}>{msg.text}</p>}

      {links.length > 5 && <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t.search} className={`${input} max-w-xs`} />}
      {!!shown.length && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-start text-stone-500 text-xs">
              <th className="text-start py-1">{t.itemCode}</th><th className="text-start">{t.costItem}</th><th className="text-start">{t.price}</th><th />
            </tr></thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.id} className="border-t border-stone-100">
                  <td className="py-2" dir="ltr">{l.itemCode}</td>
                  <td>{l.costName} <span className="text-xs text-stone-500" dir="ltr">{l.costCode}</span></td>
                  <td dir="ltr">{l.price === null ? "—" : l.price.toFixed(2)} <span className="text-xs text-stone-500">{t.source[l.source as "erp" | "manual"]}</span></td>
                  <td className="text-end">
                    <button disabled={busy} className="text-xs text-red-800 underline"
                      onClick={async () => { if (await ask({ title: t.remove, message: t.askRemove(l.costName, l.itemCode), danger: true, confirmLabel: t.remove, cancelLabel: t.cancel })) run(() => removeCostLink(l.id)); }}>
                      {t.remove}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
