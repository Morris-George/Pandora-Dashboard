import type { AppRole } from "@/lib/auth";

// Screens per role (BRD 4.2). Items not built yet are listed so the menu matches the prototype.
export const NAV: { href: string; label: string; roles: AppRole[]; ready: boolean }[] = [
  { href: "/", label: "My work", roles: ["associate", "manager", "courier", "hq", "technician", "supervisor", "cs", "finance", "ops", "admin"], ready: true },
  { href: "/intake", label: "New Maintenance Ticket", roles: ["associate", "manager"], ready: true },
  { href: "/tickets", label: "Tickets", roles: ["associate", "manager", "courier", "hq", "technician", "supervisor", "cs", "finance", "ops", "admin"], ready: true },
  { href: "/dispatch", label: "Dispatches & Returns", roles: ["associate", "manager", "courier", "hq", "technician", "supervisor"], ready: true },
  { href: "/diagnosis", label: "Diagnosis", roles: ["technician", "supervisor", "hq"], ready: true },
  { href: "/quotes", label: "Quote approval", roles: ["cs"], ready: true },
  { href: "/pickup", label: "Pickup", roles: ["associate", "manager"], ready: true },
  { href: "/tracking", label: "Ticket Tracking", roles: ["associate", "manager", "courier", "hq", "technician", "supervisor", "cs", "finance", "ops", "admin"], ready: true },
  { href: "/reports", label: "Reports", roles: ["associate", "manager", "courier", "hq", "technician", "supervisor", "cs", "finance", "ops", "admin"], ready: true },
  { href: "/admin", label: "Admin", roles: ["admin"], ready: true },
];

// Super Admin sees every screen
export function navFor(role: AppRole, isAdmin = false) {
  return NAV.filter((n) => isAdmin || n.roles.includes(role));
}
