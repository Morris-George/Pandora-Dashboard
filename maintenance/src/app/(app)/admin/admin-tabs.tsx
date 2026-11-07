"use client";

import { useEffect, useState, type ReactNode } from "react";

// Admin sections as tabs, styled like the New Maintenance Ticket steps. Hidden tabs stay mounted
// so unsaved edits survive switching; the open tab is kept in the address (#tab-N).
export function AdminTabs({ label, tabs }: { label: string; tabs: { title: string; content: ReactNode }[] }) {
  const [tab, setTab] = useState(0);
  useEffect(() => {
    const n = Number(window.location.hash.replace("#tab-", ""));
    if (n > 0 && n < tabs.length) setTab(n);
  }, [tabs.length]);
  const open = (n: number) => { setTab(n); history.replaceState(null, "", `#tab-${n}`); };

  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" aria-label={label} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {tabs.map((t, n) => (
          <button key={n} type="button" role="tab" aria-selected={tab === n} onClick={() => open(n)}
            className={`w-full rounded-xl border px-2 py-2.5 text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 transition
              ${tab === n ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)] shadow-sm" : "border-stone-200 bg-white text-stone-600"}`}>
            <span className={`grid place-items-center w-6 h-6 rounded-full text-xs ${tab === n ? "bg-white/30" : "bg-stone-100"}`}>{n + 1}</span>
            {t.title}
          </button>
        ))}
      </div>
      {tabs.map((t, n) => (
        <div key={n} role="tabpanel" hidden={tab !== n} className={tab === n ? "flex flex-col gap-6" : "hidden"}>{t.content}</div>
      ))}
    </div>
  );
}
