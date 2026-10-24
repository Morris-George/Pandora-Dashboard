import Link from "next/link";
import type { AppRole, Session } from "@/lib/auth";

// Screens that differ per role: a Super Admin picks which role's version to use (?as=role)
export function screenRole(me: Session, as: string | undefined, roles: AppRole[]): AppRole {
  if (!me.fullAccess) return me.role;
  return roles.includes(as as AppRole) ? (as as AppRole) : roles[0];
}

export function RoleTabs({ me, path, current, roles, labels, title }: {
  me: Session; path: string; current: AppRole; roles: AppRole[]; labels: Record<string, string>; title: string;
}) {
  if (!me.fullAccess) return null;
  return (
    <div className="no-print flex flex-wrap items-center gap-2 mb-4 text-sm">
      <span className="text-stone-500">{title}</span>
      {roles.map((r) => (
        <Link key={r} href={`${path}?as=${r}`} aria-current={r === current ? "page" : undefined}
          className={`rounded-full px-3.5 py-1.5 border ${r === current ? "bg-[var(--accent)] border-[var(--accent)] text-[var(--on-accent)] font-bold" : "border-stone-300 bg-white"}`}>
          {labels[r]}
        </Link>
      ))}
    </div>
  );
}
