"use client";

import { useState, useTransition } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { addCategory, updateCategory } from "./actions";

type Cat = { name: string; nameAr: string; requiresComment: boolean; active: boolean; system: boolean };
const input = "rounded-lg border border-stone-300 px-3 py-2 text-sm font-normal focus:outline-2 focus:outline-stone-900";
const small = "rounded-lg border px-2.5 py-1.5 text-xs disabled:opacity-40";

export function CategoriesPanel({ locale, categories }: { locale: Locale; categories: Cat[] }) {
  const t = dictionaries[locale].admin;
  const [busy, start] = useTransition();
  const [error, setError] = useState("");
  const [arDraft, setArDraft] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [req, setReq] = useState(false);

  const run = (fn: () => Promise<{ error?: string }>, after?: () => void) =>
    start(async () => {
      setError("");
      const r = await fn();
      if (r.error) setError(t.errors[r.error] ?? t.errors.failed);
      else after?.();
    });

  return (
    <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t.catTitle}</h2>
        <p className="text-sm text-stone-600 mt-1">{t.catNote}</p>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 text-red-800 text-sm p-3">{error}</p>}

      <div className="flex flex-col">
        {categories.map((c) => {
          const ar = arDraft[c.name] ?? c.nameAr;
          return (
            <div key={c.name} className="flex flex-wrap items-center gap-3 border-t border-stone-100 py-2.5">
              <strong className="flex-[1_1_160px]" dir="ltr">{c.name}</strong>
              <input value={ar} onChange={(e) => setArDraft({ ...arDraft, [c.name]: e.target.value })} dir="rtl"
                aria-label={`${t.catNameAr} — ${c.name}`} className={`${input} w-48`} />
              {arDraft[c.name] !== undefined && arDraft[c.name] !== c.nameAr && (
                <button disabled={busy} className={`${small} border-stone-900`}
                  onClick={() => run(() => updateCategory(c.name, { nameAr: ar }), () => { const n = { ...arDraft }; delete n[c.name]; setArDraft(n); })}>
                  {t.save}
                </button>
              )}
              <span className={`text-xs font-semibold w-20 ${c.active ? "text-emerald-800" : "text-red-800"}`}>{c.active ? t.active : t.inactive}</span>
              {c.system ? (
                <span className="text-xs text-stone-500">{t.catSystem} · {t.catRequires}</span>
              ) : (
                <>
                  <button disabled={busy} className={`${small} border-stone-900 w-36`}
                    onClick={() => run(() => updateCategory(c.name, { requiresComment: !c.requiresComment }))}>
                    {c.requiresComment ? t.catRequires : t.catOptional}
                  </button>
                  <button disabled={busy} className={`${small} border-red-800 text-red-800 w-20`}
                    onClick={() => run(() => updateCategory(c.name, { active: !c.active }))}>
                    {c.active ? t.catRemove : t.catRestore}
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3 border-t border-stone-200 pt-4">
        <label className="flex flex-col gap-1.5 text-sm font-medium">{t.catName}
          <input value={name} onChange={(e) => setName(e.target.value)} dir="ltr" placeholder="e.g. Engraving" className={`${input} w-52`} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">{t.catNameAr}
          <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" placeholder="مثال: حفر" className={`${input} w-52`} />
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
