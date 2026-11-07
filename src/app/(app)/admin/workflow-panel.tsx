"use client";

import { useState, useTransition } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { setWorkflowStep } from "./actions";

export type Workflow = { manager_approval: boolean; area_manager: boolean; override_approval: boolean; supervisor_qc: boolean; cs_quote: boolean; supervisor_assign: boolean };
export const WORKFLOW_DEFAULTS: Workflow = { manager_approval: false, area_manager: true, override_approval: true, supervisor_qc: true, cs_quote: true, supervisor_assign: true };

// Optional steps in the cycle (all on by default): switched off, the step is skipped
export function WorkflowPanel({ locale, workflow }: { locale: Locale; workflow: Workflow }) {
  const t = dictionaries[locale].admin.workflow;
  const [busy, start] = useTransition();
  const [error, setError] = useState("");
  const toggle = (step: keyof Workflow) => start(async () => {
    setError("");
    const r = await setWorkflowStep(step, !workflow[step]).catch(() => ({ error: "failed" }));
    if (r.error) setError(t.failed);
  });

  return (
    <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t.title}</h2>
        <p className="text-sm text-stone-600 mt-1">{t.note}</p>
      </div>
      {(Object.keys(t.steps) as (keyof typeof t.steps)[]).map((step) => (
        <div key={step} className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-4">
          <div className="max-w-2xl">
            <div className="font-medium">{t.steps[step].name}</div>
            <p className="text-sm text-stone-600">{workflow[step] ? t.steps[step].on : t.steps[step].off}</p>
            <p className={`text-sm font-semibold mt-1 ${workflow[step] ? "text-emerald-800" : "text-amber-800"}`}>{workflow[step] ? t.on : t.off}</p>
          </div>
          <button disabled={busy} onClick={() => toggle(step)}
            className={`rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-40 ${workflow[step] ? "border border-stone-900" : "bg-[var(--accent)] text-[var(--on-accent)]"}`}>
            {workflow[step] ? t.turnOff : t.turnOn}
          </button>
        </div>
      ))}
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    </section>
  );
}
