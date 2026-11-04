"use client";

import { useState, useTransition } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { addBranch, removeBranch, setBranchWhatsapp, updateBranch } from "./actions";

const input = "rounded-lg border border-stone-300 px-3 py-2 text-sm font-normal focus:outline-2 focus:outline-stone-900";
const btn = "rounded-lg border border-stone-900 px-3 py-2 text-sm disabled:opacity-40";
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
      <div className="flex flex-col gap-2">
        <div className="hidden sm:flex gap-2 text-xs text-stone-500"><span className="flex-[1_1_200px]">{t.name}</span><span className="w-28">{t.prefix}</span><span className="w-48">{t.whatsapp}</span></div>
        {stores.map((s) => {
          const v = rows[s.id] ?? { name: s.name, prefix: s.prefix, wa: s.whatsapp ?? "" }; // a store added just now
          const dirty = v.name !== s.name || v.prefix !== s.prefix || v.wa !== (s.whatsapp ?? "");
          const set = (k: "name" | "prefix" | "wa", val: string) => { setRows({ ...rows, [s.id]: { ...v, [k]: val } }); setMsg(null); };
          return (
            <div key={s.id} className="flex flex-wrap items-center gap-2 border-t border-stone-100 pt-2">
              <input value={v.name} onChange={(e) => set("name", e.target.value)} aria-label={t.name} className={`${input} flex-[1_1_200px]`} />
              <input value={v.prefix} onChange={(e) => set("prefix", e.target.value)} dir="ltr" aria-label={t.prefix} placeholder="CFC" className={`${input} w-28`} />
              <input value={v.wa} onChange={(e) => set("wa", e.target.value)} placeholder="01xxxxxxxxx" inputMode="tel" dir="ltr"
                aria-label={`${t.whatsapp} — ${s.name}`} className={`${input} w-48`} />
              <button disabled={busy || !dirty || !v.name.trim()} onClick={() => save(s)} className={btn}>{t.save}</button>
              {!s.hq && (
                <button disabled={busy} className="text-xs font-semibold text-red-800 underline"
                  onClick={() => { if (window.confirm(t.removeConfirm(s.name))) start(async () => { const r = await removeBranch(s.id); if (r.error) setMsg({ id: s.id, ok: false, text: t.failed }); }); }}>
                  {t.remove}
                </button>
              )}
              {msg?.id === s.id && <span role="status" className={`text-xs ${msg.ok ? "text-emerald-800" : "text-red-800"}`}>{msg.text}</span>}
            </div>
          );
        })}
        <div className="flex flex-wrap items-center gap-2 border-t border-stone-200 pt-3">
          <input value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} placeholder={t.name} className={`${input} flex-[1_1_200px]`} />
          <input value={nw.prefix} onChange={(e) => setNw({ ...nw, prefix: e.target.value })} dir="ltr" placeholder={t.prefix} className={`${input} w-28`} />
          <button disabled={busy || !nw.name.trim()} className={btn}
            onClick={() => start(async () => { const r = await addBranch(nw.name, nw.prefix); if (r.error) setMsg({ id: "new", ok: false, text: r.error === "prefix" ? t.prefixInvalid : t.failed }); else setNw({ name: "", prefix: "" }); })}>
            + {t.add}
          </button>
          {msg?.id === "new" && <span role="status" className="text-xs text-red-800">{msg.text}</span>}
        </div>
      </div>
    </section>
  );
}
