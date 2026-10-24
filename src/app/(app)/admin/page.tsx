import { requireRole } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { UsersPanel, type UserRow, type PendingRow } from "./users-panel";
import { CategoriesPanel } from "./categories-panel";
import { ReportsPanel } from "./reports-panel";
import { ErpPanel } from "./erp-panel";
import { StaffPanel, type StaffRow } from "./staff-panel";
import { erpConfigured } from "@/lib/erpnext";

export const metadata = { title: "Pandora Maintenance" };

export default async function AdminPage() {
  const me = await requireRole("admin");
  const { locale } = await getI18n();
  const supabase = await createClient();

  const [{ data: profiles }, { data: links }, { data: branches }, { data: pending }, { data: cats }, { data: reports }, { data: access }, { data: runs }, { data: excl }, { data: sps }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, role, active, source, must_change_password, erp_created_run").order("full_name"),
    supabase.from("user_branches").select("user_id, branch_id"),
    supabase.from("branches").select("id, name, is_hq").eq("active", true).order("name"),
    supabase.from("role_change_requests").select("id, user_id, new_role, requested_by").eq("status", "pending"),
    supabase.from("fault_categories").select("name, name_ar, requires_comment, active, is_system").order("sort_order"),
    supabase.from("reports").select("key, is_financial"),
    supabase.from("report_access").select("report_key, role, level"),
    supabase.from("erp_sync_runs").select("id, started_at, trigger, ok, summary").neq("trigger", "login").order("started_at", { ascending: false }).limit(1),
    supabase.from("erp_sync_exclusions").select("email, reason").order("email"),
    supabase.from("sales_persons").select("erp_name, erp_group, branch_id, branch_override, profile_id, enabled, ignored, created_run, sync_paused").order("erp_name"),
  ]);

  // "New" = added by the latest full sync (nightly or Sync now)
  const lastRunId = (runs?.[0] as { id?: number } | undefined)?.id ?? null;
  const users: UserRow[] = (profiles ?? []).map((p) => ({
    id: p.id, name: p.full_name, email: p.email, role: p.role, active: p.active, source: p.source,
    mustChange: p.must_change_password,
    isNew: !!lastRunId && p.erp_created_run === lastRunId,
    branchIds: (links ?? []).filter((l) => l.user_id === p.id).map((l) => l.branch_id),
  }));
  const byId = new Map(users.map((u) => [u.id, u.name]));
  const pendingRows: PendingRow[] = (pending ?? []).map((r) => ({
    id: r.id, userName: byId.get(r.user_id) ?? "—", newRole: r.new_role, mine: r.requested_by === me.userId,
  }));

  return (
    <div className="flex flex-col gap-6">
      <ErpPanel locale={locale} configured={erpConfigured()} excluded={excl ?? []}
        lastRun={runs?.[0] ? { at: runs[0].started_at, trigger: runs[0].trigger, ok: runs[0].ok, summary: runs[0].summary } : null} />
      <StaffPanel locale={locale}
        branches={(branches ?? []).filter((b) => !b.is_hq).map((b) => ({ id: b.id, name: b.name }))}
        accounts={users.filter((u) => u.active && u.role !== "admin").map((u) => ({ id: u.id, name: `${u.name} · ${u.email}` }))}
        rows={(sps ?? []).map((r): StaffRow => ({
          erpName: r.erp_name, erpGroup: r.erp_group, branchId: r.branch_id, override: r.branch_override,
          profileId: r.profile_id, enabled: r.enabled, ignored: r.ignored, paused: r.sync_paused, isNew: !!lastRunId && r.created_run === lastRunId,
        }))} />
      <UsersPanel locale={locale} meId={me.userId} users={users} pending={pendingRows}
        branches={(branches ?? []).filter((b) => !b.is_hq).map((b) => ({ id: b.id, name: b.name }))} />
      <CategoriesPanel locale={locale} categories={(cats ?? []).map((c) => ({
        name: c.name, nameAr: c.name_ar ?? "", requiresComment: c.requires_comment, active: c.active, system: c.is_system,
      }))} />
      <ReportsPanel locale={locale} reports={(reports ?? []).map((r) => ({ key: r.key, financial: r.is_financial }))}
        grants={Object.fromEntries((access ?? []).map((a) => [`${a.report_key}:${a.role}`, a.level]))} />
    </div>
  );
}
