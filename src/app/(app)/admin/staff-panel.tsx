"use client";

import { useState, useTransition } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { createAccountForSalesPerson, linkSalesPerson, mergeSalesPerson, setSalesPersonIgnored, setSalesPersonStore, setSalesPersonSyncPaused } from "./actions";

export type StaffRow = {
  erpName: string; erpGroup: string | null; branchId: string | null; override: string | null;
  profileId: string | null; enabled: boolean; ignored: boolean; isNew: boolean; paused: boolean;
};
type Opt = { id: string; name: string };

// Sales persons from ERPNext with their store allocation. New and unallocated people stand out.
export function StaffPanel({ locale, rows, branches, accounts }: { locale: Locale; rows: StaffRow[]; branches: Opt[]; accounts: Opt[] }) {
  const t = dictionaries[locale].admin.staff;
  const [busy, start] = useTransition();
  const [error, setError] = useState("");
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  const [filter, setFilter] = useState<"attention" | "all" | "removed">("attention");
  const bName = new Map(branches.map((b) => [b.id, b.name]));
  const aName = new Map(accounts.map((a) => [a.id, a.name]));

  const store = (r: StaffRow) => r.override ?? r.branchId;
  const needs = (r: StaffRow) => r.enabled && !r.ignored && (r.isNew || !store(r) || !r.profileId);
  const shown = rows.filter((r) => (filter === "removed" ? r.ignored : !r.ignored && (filter === "all" || needs(r))));
  const counts = {
    newOnes: rows.filter((r) => r.isNew && !r.ignored).length,
    unallocated: rows.filter((r) => r.enabled && !r.ignored && !store(r)).length,
    noAccount: rows.filter((r) => r.enabled && !r.ignored && !r.profileId).length,
  };

  const run = (fn: () => Promise<{ error?: string; password?: string }>, email?: string) =>
    start(async () => {
      setError("");
      // A page left open across a deploy throws here: show a message instead of crashing
      const r = await fn().catch(() => ({ error: "stale" } as { error: string; password?: string }));
      if (r.error) setError(dictionaries[locale].admin.errors[r.error] ?? dictionaries[locale].admin.errors.failed);
      else if (r.password && email) setTemp({ email, password: r.password });
    });

  return (
    <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t.title}</h2>
        <p className="text-sm text-stone-600 mt-1 max-w-3xl">{t.note}</p>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <Badge tone="new" label={t.countNew(counts.newOnes)} />
        <Badge tone="bad" label={t.countUnallocated(counts.unallocated)} />
        <Badge tone="warn" label={t.countNoAccount(counts.noAccount)} />
      </div>

      {temp && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex flex-col gap-2">
          <strong>{dictionaries[locale].admin.tempTitle}</strong>
          <code className="text-lg font-mono bg-white rounded-lg border border-amber-200 px-3 py-2 select-all" dir="ltr">{temp.password}</code>
          <span className="text-sm">{dictionaries[locale].admin.tempFor(temp.email)}</span>
          <button onClick={() => setTemp(null)} className="self-start rounded-lg border border-stone-300 px-4 py-2 text-sm">{dictionaries[locale].admin.dismiss}</button>
        </div>
      )}
      {error && <p role="alert" className="rounded-lg bg-red-50 text-red-800 text-sm p-3">{error}</p>}

      <div className="flex flex-wrap gap-2" role="tablist">
        {(["attention", "all", "removed"] as const).map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
            className={`rounded-full px-3.5 py-1.5 text-sm border ${filter === f ? "bg-[var(--accent)] border-[var(--accent)] text-[var(--on-accent)] font-bold" : "border-stone-300 bg-white"}`}>
            {t.filters[f]}
          </button>
        ))}
      </div>

      {!shown.length ? <p className="text-sm text-stone-600">{filter === "attention" ? t.allGood : t.none}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="text-xs text-stone-500">{Object.values(t.cols).map((c) => <th key={c} className="p-2 text-start font-medium">{c}</th>)}</tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const sid = store(r);
                return (
                  <tr key={r.erpName} className={`border-t border-stone-100 align-top ${!sid && r.enabled ? "bg-red-50/60" : r.isNew ? "bg-[var(--fill-soft)]/50" : ""}`}>
                    <td className="p-2">
                      <div className="font-semibold flex items-center gap-2">
                        {r.erpName}
                        {r.isNew && <span className="rounded-full bg-[var(--accent)] text-[var(--on-accent)] px-2 py-0.5 text-[11px] font-bold">{t.new}</span>}
                        {r.paused && <span className="rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 text-[11px] font-bold">{t.syncStopped}</span>}
                        {!r.enabled && <span className="rounded-full bg-stone-200 text-stone-600 px-2 py-0.5 text-[11px]">{t.disabledInErp}</span>}
                      </div>
                      <div className="text-xs text-stone-500">{t.erpGroup}: {r.erpGroup ?? "—"}</div>
                    </td>
                    <td className="p-2">
                      <select value={r.override ?? ""} disabled={busy} aria-label={t.cols.store}
                        onChange={(e) => run(() => setSalesPersonStore(r.erpName, e.target.value || null))}
                        className={`rounded-lg border px-2 py-1.5 text-sm ${sid ? "border-stone-300" : "border-red-400 text-red-800 font-semibold"}`}>
                        <option value="">{r.branchId ? `${bName.get(r.branchId)} ${t.fromErp}` : t.notAllocated}</option>
                        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </td>
                    <td className="p-2">
                      <select value={r.profileId ?? ""} disabled={busy} aria-label={t.cols.account}
                        onChange={(e) => {
                          const id = e.target.value;
                          // Merge: picking an account with a different name offers to use the ERPNext name
                          if (id && aName.get(id) !== r.erpName && window.confirm(t.askMerge(aName.get(id) ?? "", r.erpName))) run(() => mergeSalesPerson(r.erpName, id));
                          else run(() => linkSalesPerson(r.erpName, id || null));
                        }}
                        className={`rounded-lg border px-2 py-1.5 text-sm max-w-56 ${r.profileId ? "border-stone-300" : "border-amber-400 text-amber-800"}`}>
                        <option value="">{t.noAccount}</option>
                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                      {r.profileId && aName.get(r.profileId) !== r.erpName && (
                        <button disabled={busy} className="mt-1 block text-xs underline text-stone-700" onClick={() => run(() => mergeSalesPerson(r.erpName, r.profileId!))}>
                          {t.useErpName(r.erpName)}
                        </button>
                      )}
                    </td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1.5">
                        {!r.profileId && r.enabled && (
                          <button disabled={busy || !sid} title={!sid ? t.allocateFirst : undefined}
                            className="rounded-lg border border-stone-900 px-2.5 py-1.5 text-xs disabled:opacity-40"
                            onClick={() => {
                              const email = window.prompt(t.askEmail(r.erpName), "");
                              if (!email) return;
                              const manager = window.confirm(t.askManager);
                              run(() => createAccountForSalesPerson(r.erpName, email, manager ? "manager" : "associate"), email.trim().toLowerCase());
                            }}>{t.add}</button>
                        )}
                        <button disabled={busy} className="rounded-lg border border-amber-700 text-amber-800 px-2.5 py-1.5 text-xs"
                          onClick={() => run(() => setSalesPersonSyncPaused(r.erpName, !r.paused))}>{r.paused ? t.resumeSync : t.stopSync}</button>
                        {r.ignored ? (
                          <button disabled={busy} className="rounded-lg border border-stone-400 px-2.5 py-1.5 text-xs" onClick={() => run(() => setSalesPersonIgnored(r.erpName, false))}>{t.restore}</button>
                        ) : (
                          <button disabled={busy} className="rounded-lg border border-red-800 text-red-800 px-2.5 py-1.5 text-xs"
                            onClick={() => { if (window.confirm(t.askRemove(r.erpName))) run(() => setSalesPersonIgnored(r.erpName, true)); }}>{t.remove}</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Badge({ tone, label }: { tone: "new" | "bad" | "warn"; label: string }) {
  const c = { new: "bg-[var(--fill-soft)] text-[#2A1018] border-[var(--accent)]", bad: "bg-red-50 text-red-800 border-red-200", warn: "bg-amber-50 text-amber-900 border-amber-200" }[tone];
  return <span className={`rounded-full border px-3 py-1 font-semibold ${c}`}>{label}</span>;
}
