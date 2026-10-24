"use client";

import { useState, useTransition } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import type { AppRole } from "@/lib/auth";
import { setReportAccess } from "./actions";

type Level = "none" | "view" | "export";
type Report = { key: string; financial: boolean };

// Admin is left out: it never sees ticket data (SoD-4)
const ROLES: Exclude<AppRole, "admin">[] = ["associate", "manager", "courier", "hq", "technician", "supervisor", "cs", "finance", "ops"];
const LEVELS: Level[] = ["none", "view", "export"];

export function ReportsPanel({ locale, reports, grants }: {
  locale: Locale; reports: Report[]; grants: Record<string, Level>;
}) {
  const d = dictionaries[locale];
  const t = d.admin;
  const [busy, start] = useTransition();
  const [error, setError] = useState("");

  const change = (reportKey: string, role: Exclude<AppRole, "admin">, level: Level) =>
    start(async () => {
      setError("");
      const r = await setReportAccess({ reportKey, role, level });
      if (r.error) setError(t.errors[r.error] ?? t.errors.failed);
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
                  const level = grants[`${rep.key}:${role}`] ?? "none";
                  return (
                    <td key={role} className="p-2">
                      <select value={level} disabled={busy} aria-label={`${t.repNames[rep.key] ?? rep.key} — ${d.roles[role]}`}
                        onChange={(e) => change(rep.key, role, e.target.value as Level)}
                        className={`rounded-lg border px-2 py-1.5 text-xs ${level === "none" ? "border-stone-200 text-stone-400" : level === "export" ? "border-emerald-700 text-emerald-800 font-semibold" : "border-stone-900"}`}>
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
    </section>
  );
}
