"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ items }: { items: { href: string; label: string; ready: boolean; soon: string }[] }) {
  const path = usePathname();
  return (
    <>
      {items.map((n, i) => {
        const active = path === n.href || path.startsWith(`${n.href}/`);
        return n.ready ? (
          <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} style={{ animationDelay: `${i * 35}ms` }}
            className={`nav-item group relative rounded-xl px-4 py-2.5 text-sm transition-all duration-200
              ${active ? "bg-[var(--accent)] text-[var(--on-accent)] font-bold border border-[var(--accent)] shadow-md shadow-[#E86F80]/25" : "bg-white border border-stone-200 text-stone-700 hover:border-[var(--accent)] hover:text-stone-900 hover:shadow-sm hover:-translate-y-px"}`}>
            <span className={`absolute inset-y-2 start-0 w-1 rounded-full bg-[var(--accent)] transition-all duration-300 ${active ? "opacity-100" : "opacity-0 group-hover:opacity-60"}`} />
            {n.label}
          </Link>
        ) : (
          <span key={n.href} className="nav-item rounded-xl px-4 py-2.5 text-sm bg-white/60 border border-dashed border-stone-200 text-stone-400 flex justify-between gap-2">
            {n.label}<span className="text-[11px]">{n.soon}</span>
          </span>
        );
      })}
    </>
  );
}
