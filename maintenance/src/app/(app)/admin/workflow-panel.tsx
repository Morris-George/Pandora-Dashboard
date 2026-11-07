"use client";

import { useState, useTransition } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { setWorkflowStep } from "./actions";

export type Workflow = { manager_approval: boolean; area_manager: boolean; override_approval: boolean; supervisor_qc: boolean; cs_quote: boolean; supervisor_assign: boolean; courier_out: boolean; courier_return: boolean };
export const WORKFLOW_DEFAULTS: Workflow = { manager_approval: false, area_manager: true, override_approval: true, supervisor_qc: true, cs_quote: true, supervisor_assign: true, courier_out: false, courier_return: false };

type Step = Exclude<keyof Workflow, "manager_approval">;
// The cycle in order; each optional step sits under the stage it belongs to
const STAGES: { key: "store" | "transport" | "hq" | "customer" | "back"; icon: string; steps: Step[] }[] = [
  { key: "store", icon: "🏬", steps: [] },
  { key: "transport", icon: "🚚", steps: ["area_manager", "courier_out", "courier_return"] },
  { key: "hq", icon: "🛠️", steps: ["supervisor_assign", "override_approval", "supervisor_qc"] },
  { key: "customer", icon: "💬", steps: ["cs_quote"] },
  { key: "back", icon: "🛍️", steps: [] },
];
// Steps that only matter while another one is on
const NEEDS: Partial<Record<Step, Step>> = { courier_out: "area_manager", courier_return: "area_manager" };

// Admin → Workflow: the cycle at a glance, then each optional step as a switch under its stage
export function WorkflowPanel({ locale, workflow }: { locale: Locale; workflow: Workflow }) {
  const t = dictionaries[locale].admin.workflow;
  const [busy, start] = useTransition();
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Step | null>(null);
  const toggle = (step: Step) => start(async () => {
    setError(""); setPending(step);
    const r = await setWorkflowStep(step, !workflow[step]).catch(() => ({ error: "failed" }));
    if (r.error) setError(t.failed);
    setPending(null);
  });

  return (
    <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">{t.title}</h2>
        <p className="text-sm text-stone-600 mt-1 max-w-3xl">{t.note}</p>
      </div>

      {/* The cycle: one chip per stage, with how many of its optional steps are on */}
      <ol className="flex flex-wrap items-center gap-2" aria-label={t.cycle}>
        {STAGES.map((s, i) => {
          const on = s.steps.filter((k) => workflow[k]).length;
          return (
            <li key={s.key} className="flex items-center gap-2">
              <a href={s.steps.length ? `#wf-${s.key}` : undefined}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${s.steps.length ? "border-stone-300 bg-white hover:border-[var(--accent)]" : "border-stone-200 bg-stone-50 text-stone-600"}`}>
                <span aria-hidden>{s.icon}</span>
                <span className="font-medium">{t.stages[s.key]}</span>
                {s.steps.length > 0 && <span className="rounded-full bg-stone-100 px-2 text-xs tabular-nums">{on}/{s.steps.length}</span>}
              </a>
              {i < STAGES.length - 1 && <span aria-hidden className="text-stone-400 rtl:rotate-180">→</span>}
            </li>
          );
        })}
      </ol>

      <div className="grid gap-4 lg:grid-cols-3">
        {STAGES.filter((s) => s.steps.length).map((s) => (
          <div key={s.key} id={`wf-${s.key}`} className="rounded-xl border border-stone-200 overflow-hidden flex flex-col">
            <div className="flex items-center gap-2 bg-stone-50 px-4 py-3 border-b border-stone-200">
              <span aria-hidden className="text-lg">{s.icon}</span>
              <h3 className="font-semibold">{t.stages[s.key]}</h3>
            </div>
            <ul className="flex flex-col">
              {s.steps.map((k) => {
                const on = workflow[k];
                const blocked = NEEDS[k] && !workflow[NEEDS[k]!];
                return (
                  <li key={k} className={`flex items-start gap-3 px-4 py-3 border-t border-stone-100 first:border-t-0 ${NEEDS[k] ? "ps-8" : ""} ${blocked ? "opacity-50" : ""}`}>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{t.steps[k].name}</div>
                      <p className="text-xs text-stone-600 mt-0.5 leading-relaxed">{on ? t.steps[k].on : t.steps[k].off}</p>
                      {blocked && <p className="text-xs text-amber-800 mt-1">{t.needsPickup}</p>}
                    </div>
                    {/* Switch */}
                    <button type="button" role="switch" aria-checked={on} aria-label={t.steps[k].name} disabled={busy || !!blocked} onClick={() => toggle(k)}
                      className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed ${on ? "bg-emerald-600" : "bg-stone-300"} ${pending === k ? "animate-pulse" : ""}`}>
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "start-[1.375rem]" : "start-0.5"}`} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    </section>
  );
}
