"use client";

import { useState, useTransition } from "react";
import { useAsk } from "@/components/ask";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { addCategory, setCategoryCost, syncCategoryCosts, deleteCategory, updateCategory } from "./actions";
import { toast } from "@/components/toast";

type Cat = { name: string; nameAr: string; requiresComment: boolean; active: boolean; system: boolean; erpCode: string | null; erpName: string | null; cost: number | null; costSource: string | null };
const input = "h-10 w-full rounded-lg border border-stone-300 px-3 text-sm font-normal focus:outline-2 focus:outline-stone-900";
// English name | Arabic name | ERPNext code | cost | save — same columns on every row; stacks on phones
const grid = "grid-cols-1 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_9rem_8rem_6rem] gap-2 md:gap-3 items-center";
const saveBtn = "h-10 rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-4 text-sm font-semibold disabled:bg-stone-100 disabled:text-stone-400";
const chip = "rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40";
const small = "rounded-lg border px-2.5 py-1.5 text-xs disabled:opacity-40";

export function CategoriesPanel({ locale, categories }: { locale: Locale; categories: Cat[] }) {
  const t = dictionaries[locale].admin;
  const [busy, start] = useTransition();
  const [ask, askDialog] = useAsk();
  const [error, setError] = useState("");
  const [arDraft, setArDraft] = useState<Record<string, string>>({});
  const [enDraft, setEnDraft] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [req, setReq] = useState(false);
  const [costDraft, setCostDraft] = useState<Record<string, { code: string; cost: string }>>({});

  const run = (fn: () => Promise<{ error?: string }>, after?: () => void) =>
    start(async () => {
      setError("");
      const r = await fn();
      if (r.error) setError(t.errors[r.error] ?? t.catCost.errors[r.error as keyof typeof t.catCost.errors] ?? t.errors.failed);
      else { toast(); after?.(); }
    });

  return (
    <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4">
      {askDialog}
      <div>
        <h2 className="text-lg font-semibold">{t.catTitle}</h2>
        <p className="text-sm text-stone-600 mt-1">{t.catNote}</p>
        <p className="text-sm text-stone-600 mt-1">{t.catCost.note}</p>
        <button disabled={busy} className={`${small} border-stone-900 mt-2`} onClick={() => run(() => syncCategoryCosts())}>{t.catCost.sync}</button>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 text-red-800 text-sm p-3">{error}</p>}

      <div className="rounded-xl border border-stone-200 overflow-hidden">
        <div className={`${grid} hidden md:grid bg-stone-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-stone-500`}>
          <span>{t.catName}</span><span>{t.catNameAr}</span><span>{t.catCost.code}</span><span>{t.catCost.cost}</span><span />
        </div>
        {categories.map((c) => {
          const en = enDraft[c.name] ?? c.name;
          const ar = arDraft[c.name] ?? c.nameAr;
          const cd = costDraft[c.name] ?? { code: c.erpCode ?? "", cost: c.cost === null ? "" : String(c.cost) };
          const costChanged = cd.code !== (c.erpCode ?? "") || cd.cost !== (c.cost === null ? "" : String(c.cost));
          const enChanged = !c.system && en.trim() !== "" && en !== c.name;
          const arChanged = ar !== c.nameAr;
          const dirty = costChanged || enChanged || arChanged;
          const clear = () => { const e = { ...enDraft }, r = { ...arDraft }, k = { ...costDraft }; delete e[c.name]; delete r[c.name]; delete k[c.name]; setEnDraft(e); setArDraft(r); setCostDraft(k); };
          // One Save per row: cost first (keyed by the current name), then the names
          const save = () => run(async () => {
            if (costChanged) { const r = await setCategoryCost(c.name, cd.code, cd.cost); if (r.error) return r; }
            if (arChanged || enChanged) return updateCategory(c.name, { ...(arChanged ? { nameAr: ar } : {}), ...(enChanged ? { name: en } : {}) });
            return {};
          }, clear);
          return (
            <div key={c.name} className={`border-t border-stone-100 px-4 py-3 flex flex-col gap-2 ${dirty ? "bg-amber-50/60" : !c.active ? "bg-stone-50 opacity-70" : ""}`}>
              <div className={`${grid} grid`}>
                {c.system ? <span className={`${input} flex items-center font-semibold bg-stone-50`} dir="ltr">{c.name}</span> : (
                  <input value={en} onChange={(e) => setEnDraft({ ...enDraft, [c.name]: e.target.value })} dir="ltr" aria-label={t.catName} className={`${input} font-semibold`} />
                )}
                <input value={ar} onChange={(e) => setArDraft({ ...arDraft, [c.name]: e.target.value })} dir="rtl" aria-label={`${t.catNameAr} — ${c.name}`} className={input} />
                <input value={cd.code} onChange={(e) => setCostDraft({ ...costDraft, [c.name]: { ...cd, code: e.target.value } })} dir="ltr"
                  placeholder={t.catCost.codePh} aria-label={`${t.catCost.code} — ${c.name}`} className={`${input} font-mono`} />
                <input value={cd.cost} onChange={(e) => setCostDraft({ ...costDraft, [c.name]: { ...cd, cost: e.target.value.replace(/[^\d.]/g, "") } })} dir="ltr" inputMode="decimal"
                  placeholder={t.catCost.costPh} aria-label={`${t.catCost.cost} — ${c.name}`} className={`${input} tabular-nums`} />
                <button disabled={busy || !dirty} onClick={save} className={saveBtn}>{t.save}</button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded-full px-2 py-0.5 font-semibold ${c.active ? "bg-emerald-50 text-emerald-800" : "bg-stone-200 text-stone-700"}`}>{c.active ? t.active : t.inactive}</span>
                <span className="text-stone-600">
                  {c.erpName && <span>{c.erpName} · </span>}
                  {c.cost !== null ? `${c.cost.toFixed(2)} ${t.catCost.beforeVat} (${t.catCost.source[c.costSource as "erp" | "manual"] ?? ""})` : c.erpCode ? t.catCost.noPrice : ""}
                </span>
                <span className="flex-1" />
                {c.system ? <span className="text-stone-500">{t.catSystem} · {t.catRequires}</span> : (
                  <>
                    <button disabled={busy} className={`${chip} border-stone-300`} onClick={() => run(() => updateCategory(c.name, { requiresComment: !c.requiresComment }))}>
                      {c.requiresComment ? t.catRequires : t.catOptional}
                    </button>
                    <button disabled={busy} className={`${chip} border-stone-300`} onClick={() => run(() => updateCategory(c.name, { active: !c.active }))}>
                      {c.active ? t.catRemove : t.catRestore}
                    </button>
                    <button disabled={busy} className={`${chip} border-red-200 text-red-800 hover:bg-red-50`}
                      onClick={async () => { if (await ask({ title: t.catDelete, message: t.catDeleteConfirm(c.name), confirmLabel: t.catDelete, cancelLabel: t.dlg.cancel, danger: true })) run(() => deleteCategory(c.name)); }}>
                      {t.catDelete}
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3 border-t border-stone-200 pt-4">
        <label className="flex flex-col gap-1.5 text-sm font-medium">{t.catName}
          <input value={name} onChange={(e) => setName(e.target.value)} dir="ltr" placeholder="e.g. Engraving" className={`${input} md:w-52`} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">{t.catNameAr}
          <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" placeholder="مثال: حفر" className={`${input} md:w-52`} />
        </label>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input type="checkbox" checked={req} onChange={(e) => setReq(e.target.checked)} /> {t.catRequires}
        </label>
        <button disabled={busy || name.trim().length < 2}
          onClick={() => run(() => addCategory({ name, nameAr, requiresComment: req }), () => { setName(""); setNameAr(""); setReq(false); })}
          className="rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-5 py-2.5 font-semibold disabled:opacity-40">
          {t.catAdd}
        </button>
      </div>
    </section>
  );
}
