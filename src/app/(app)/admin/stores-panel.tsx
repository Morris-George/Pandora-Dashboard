"use client";

import { useState, useTransition } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { addBranch, removeBranch, setBranchWhatsapp, updateBranch } from "./actions";

const input = "h-10 w-full rounded-lg border border-stone-300 px-3 text-sm focus:outline-2 focus:outline-stone-900";
// Name | prefix | WhatsApp | save | remove — same columns on every row; stacks on phones
const grid = "grid-cols-1 sm:grid-cols-[minmax(0,1fr)_8rem_12rem_6rem_5.5rem] gap-2 sm:gap-3 items-center";
const saveBtn = "h-10 rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-4 text-sm font-semibold disabled:bg-stone-100 disabled:text-stone-400";
const removeBtn = "h-10 rounded-lg border border-red-200 text-red-800 px-3 text-sm hover:bg-red-50 disabled:opacity-40";
type Store = { id: string; name: string; whatsapp: string | null; prefix: string; hq: boolean };

// Admin → Stores: add, rename, change ticket prefix, remove, and each store's WhatsApp number
export function StoresPanel({ locale, stores }: { locale: Locale; stores: Store[] }) {
  const t = dictionaries[locale].admin.stores;
  const [busy, start] = useTransition();
  const [rows, setRows] = useState(Object.fromEntries(stores.map((s) => [s.id, { name: s.name, prefix: s.prefix, wa: s.whatsapp ?? "" }])));
  const [msg, setMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [nw, setNw] = useState({ name: "", prefix: "" });

  const save = (s: Store) => start(async () => {
    setMsg(null);
    const v = rows[s.id] ?? { name: s.name, prefix: s.prefix, wa: s.whatsapp ?? "" };
    if (v.name !== s.name || v.prefix !== s.prefix) {
      const r = await updateBranch(s.id, v.name, v.prefix).catch(() => ({ error: "failed" }));
      if (r.error) { setMsg({ id: s.id, ok: false, text: r.error === "prefix" ? t.prefixInvalid : t.failed }); return; }
    }
    if (v.wa !== (s.whatsapp ?? "")) {
      const r = await setBranchWhatsapp(s.id, v.wa).catch(() => ({ error: "failed" }));
      if (r.error) { setMsg({ id: s.id, ok: false, text: t.invalid }); return; }
      if ("value" in r) setRows((x) => ({ ...x, [s.id]: { ...x[s.id], wa: r.value ?? "" } }));
    }
    setMsg({ id: s.id, ok: true, text: t.saved });
  });

  return (
    <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t.title}</h2>
        <p className="text-sm text-stone-600 mt-1 max-w-2xl">{t.note}</p>
      </div>
      <div className="rounded-xl border border-stone-200 overflow-hidden">
        <div className={`${grid} hidden sm:grid bg-stone-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-stone-500`}>
          <span>{t.name}</span><span>{t.prefix}</span><span>{t.whatsapp}</span><span /><span />
        </div>
        {stores.map((s) => {
          const v = rows[s.id] ?? { name: s.name, prefix: s.prefix, wa: s.whatsapp ?? "" }; // a store added just now
          const dirty = v.name !== s.name || v.prefix !== s.prefix || v.wa !== (s.whatsapp ?? "");
          const set = (k: "name" | "prefix" | "wa", val: string) => { setRows({ ...rows, [s.id]: { ...v, [k]: val } }); setMsg(null); };
          return (
            <div key={s.id} className={`border-t border-stone-100 px-4 py-3 ${dirty ? "bg-amber-50/60" : ""}`}>
              <div className={`${grid} grid`}>
                <input value={v.name} onChange={(e) => set("name", e.target.value)} aria-label={t.name} className={`${input} font-medium`} />
                <input value={v.prefix} onChange={(e) => set("prefix", e.target.value)} dir="ltr" aria-label={t.prefix} placeholder="CFC" className={`${input} font-mono`} />
                <input value={v.wa} onChange={(e) => set("wa", e.target.value)} placeholder="01xxxxxxxxx" inputMode="tel" dir="ltr"
                  aria-label={`${t.whatsapp} — ${s.name}`} className={input} />
                <button disabled={busy || !dirty || !v.name.trim()} onClick={() => save(s)} className={saveBtn}>{t.save}</button>
                {s.hq ? <span /> : (
                  <button disabled={busy} className={removeBtn}
                    onClick={() => { if (window.confirm(t.removeConfirm(s.name))) start(async () => { const r = await removeBranch(s.id); if (r.error) setMsg({ id: s.id, ok: false, text: t.failed }); }); }}>
                    {t.remove}
                  </button>
                )}
              </div>
              {msg?.id === s.id && <p role="status" className={`mt-1.5 text-xs ${msg.ok ? "text-emerald-800" : "text-red-800"}`}>{msg.text}</p>}
            </div>
          );
        })}
        <div className="border-t border-stone-200 bg-stone-50 px-4 py-3">
          <div className={`${grid} grid`}>
            <input value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} placeholder={t.name} aria-label={t.name} className={`${input} bg-white`} />
            <input value={nw.prefix} onChange={(e) => setNw({ ...nw, prefix: e.target.value })} dir="ltr" placeholder={t.prefix} aria-label={t.prefix} className={`${input} bg-white font-mono`} />
            <span className="hidden sm:block" />
            <button disabled={busy || !nw.name.trim()} className={`${saveBtn} sm:col-span-2`}
              onClick={() => start(async () => { const r = await addBranch(nw.name, nw.prefix); if (r.error) setMsg({ id: "new", ok: false, text: r.error === "prefix" ? t.prefixInvalid : t.failed }); else setNw({ name: "", prefix: "" }); })}>
              + {t.add}
            </button>
          </div>
          {msg?.id === "new" && <p role="status" className="mt-1.5 text-xs text-red-800">{msg.text}</p>}
        </div>
      </div>
    </section>
  );
}
