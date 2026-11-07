"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

// "Store" filter for roles above the branch manager: keeps the choice in the address (?store=<id>)
export function StoreFilter({ stores, value, label, all }: { stores: { id: string; name: string }[]; value: string; label: string; all: string }) {
  const router = useRouter(), path = usePathname(), params = useSearchParams();
  if (stores.length < 2) return null;
  return (
    <label className="flex items-center gap-2 text-sm font-medium">{label}
      <select value={value} onChange={(e) => {
        const p = new URLSearchParams(params.toString());
        if (e.target.value) p.set("store", e.target.value); else p.delete("store");
        router.push(`${path}${p.size ? `?${p}` : ""}`);
      }} className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-normal bg-white">
        <option value="">{all}</option>
        {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </label>
  );
}
