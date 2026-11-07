"use client";

import { useState, useTransition } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import type { AppRole } from "@/lib/auth";
import { setReportAccess } from "./actions";
import { toast } from "@/components/toast";

type Level = "none" | "view" | "export";
type Report = { key: string; financial: boolean };

// Admin is left out: it never sees ticket data (SoD-4)
const ROLES: Exclude<AppRole, "admin">[] = ["associate", "manager", "courier", "delivery", "hq", "supervisor", "technician", "cs", "finance", "ops"];
const LEVELS: Level[] = ["none", "view", "export"];

export function ReportsPanel({ locale, reports, grants }: {
  locale: Locale; reports: Report[]; grants: Record<string, Level>;
}) {
  const d = dictionaries[locale];
  const t = d.admin;
  const [busy, start] = useTransition();
  const [error, setError] = useState("");

  // Changes are collected here and applied together with Save
  const [draft, setDraft] = useState<Record<string, Level>>({});
  const changed = Object.entries(draft).filter(([k, v]) => (grants[k] ?? "none") !== v);
  const save = () =>
    start(async () => {
      setError("");
      for (const [k, level] of changed) {
        const [reportKey, role] = k.split(":") as [string, Exclude<AppRole, "admin">];
        const r = await setReportAccess({ reportKey, role, level }).catch(() => ({ error: "failed" }));
        if (r.error) { setError(t.errors[r.error] ?? t.errors.failed); return; }
      }
      setDraft({});
      toast(t.repSaved(changed.length));
    });

  return (
    <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t.repTitle}</h2>
        <p className="text-sm text-stone-600 mt-1">{t.repNote}</p>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 text-red-800 text-sm p-3">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px] text-sm">
          <thead>
            <tr className="text-xs text-stone-500">
              <th className="p-2 text-start font-medium">{t.repReport}</th>
              {ROLES.map((r) => <th key={r} className="p-2 text-start font-medium">{d.roles[r]}</th>)}
            </tr>
          </thead>
          <tbody>
            {reports.map((rep) => (
              <tr key={rep.key} className="border-t border-stone-100">
                <td className="p-2">
                  <div className="font-semibold">{t.repNames[rep.key] ?? rep.key}</div>
                  {rep.financial && <span className="text-xs text-amber-800">{t.repFinancial}</span>}
                </td>
                {ROLES.map((role) => {
                  const key = `${rep.key}:${role}`;
                  const level = draft[key] ?? grants[key] ?? "none";
                  const dirty = (grants[key] ?? "none") !== level;
                  return (
                    <td key={role} className="p-2">
                      <select value={level} disabled={busy} aria-label={`${t.repNames[rep.key] ?? rep.key} — ${d.roles[role]}`}
                        onChange={(e) => setDraft({ ...draft, [key]: e.target.value as Level })}
                        className={`rounded-lg border px-2 py-1.5 text-xs ${dirty ? "ring-2 ring-amber-400 " : ""}${level === "none" ? "border-stone-200 text-stone-400" : level === "export" ? "border-emerald-700 text-emerald-800 font-semibold" : "border-stone-900"}`}>
                        {LEVELS.map((l) => <option key={l} value={l}>{t.repLevel[l]}</option>)}
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sticky bottom-0 -mx-6 -mb-6 px-6 py-4 rounded-b-2xl bg-white/95 backdrop-blur border-t border-stone-200 flex flex-wrap items-center gap-3">
        <button disabled={busy || !changed.length} onClick={save}
          className="rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-5 py-2.5 text-sm font-bold disabled:opacity-40">{t.save}</button>
        <button disabled={busy || !changed.length} onClick={() => setDraft({})}
          className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm disabled:opacity-40">{t.repDiscard}</button>
        <span className="text-sm text-stone-600">{changed.length ? t.repUnsaved(changed.length) : t.repNoChanges}</span>
      </div>
    </section>
  );
}
