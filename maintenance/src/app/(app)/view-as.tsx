"use client";

import { withBase } from "@/lib/base";
import { useTransition } from "react";
import type { AppRole } from "@/lib/auth";
import { viewAs } from "./view-as-actions";

const ROLES: AppRole[] = ["admin", "associate", "manager", "courier", "hq", "supervisor", "technician", "cs", "finance", "ops"];

// Header switch for the Super Admin: see every role's screens and access
export function ViewAs({ current, label, roles }: { current: AppRole; label: string; roles: Record<string, string> }) {
  const [busy, start] = useTransition();
  return (
    <label className={`hdr-btn flex items-center gap-1.5 cursor-pointer ${current !== "admin" ? "ring-2 ring-[#2A1018]/60" : ""}`}>
      <span className="text-xs font-semibold opacity-75">{label}</span>
      <select value={current} disabled={busy} aria-label={label}
        onChange={(e) => start(async () => {
          await viewAs(e.target.value as AppRole).catch(() => undefined);
          // Full load of the dashboard: the old screen may not exist for the new role, so no "no permission" notice
          window.location.replace(withBase("/"));
        })}
        className="bg-transparent font-bold outline-none cursor-pointer">
        {ROLES.map((r) => <option key={r} value={r}>{roles[r]}</option>)}
      </select>
    </label>
  );
}
