"use client";

import { useState, useTransition } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { NAV } from "@/lib/nav";
import { saveMenuLabels } from "./actions";

export type MenuLabels = Record<string, { ar?: string; en?: string }>;

// Menu names (Arabic + English). An empty box keeps the built-in name.
export function MenuPanel({ locale, initial }: { locale: Locale; initial: MenuLabels }) {
  const t = dictionaries[locale].admin.menu;
  const [labels, setLabels] = useState<MenuLabels>(initial);
  const [msg, setMsg] = useState("");
  const [busy, start] = useTransition();
  const input = "rounded-lg border border-stone-300 px-3 py-2 text-sm w-full";
  const set = (href: string, lang: "ar" | "en", v: string) => setLabels({ ...labels, [href]: { ...labels[href], [lang]: v } });

  return (
    <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t.title}</h2>
        <p className="text-sm text-stone-600 mt-1">{t.note}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-start text-stone-500">
            <th className="p-2 text-start font-medium">{t.english}</th><th className="p-2 text-start font-medium">{t.arabic}</th>
          </tr></thead>
          <tbody>
            {NAV.map((n) => (
              <tr key={n.href} className="border-t border-stone-100">
                <td className="p-2"><input dir="ltr" value={labels[n.href]?.en ?? ""} placeholder={dictionaries.en.nav[n.href]}
                  onChange={(e) => set(n.href, "en", e.target.value)} className={input} /></td>
                <td className="p-2"><input dir="rtl" value={labels[n.href]?.ar ?? ""} placeholder={dictionaries.ar.nav[n.href]}
                  onChange={(e) => set(n.href, "ar", e.target.value)} className={input} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={busy} onClick={() => start(async () => {
          setMsg("");
          const r = await saveMenuLabels(labels).catch(() => ({ error: "failed" }));
          setMsg(r.error ? t.failed : t.saved);
        })} className="rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-4 py-2 text-sm font-bold disabled:opacity-40">{t.save}</button>
        {msg && <p role="status" className="text-sm text-stone-700">{msg}</p>}
      </div>
    </section>
  );
}
