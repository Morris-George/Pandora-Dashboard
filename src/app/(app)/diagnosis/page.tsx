import { requireRole } from "@/lib/auth";
import { loadWorkflow } from "@/lib/workflow";
import { RoleTabs, screenRole } from "@/components/role-tabs";
import { getI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DiagnosisPanel, type Job } from "./diagnosis-panel";
import { CostLinksPanel } from "./cost-links-panel";

export const metadata = { title: "Pandora Maintenance" };

const STAGES = ["received_at_hq", "under_diagnosis", "in_repair", "awaiting_parts", "quality_check"];

export default async function DiagnosisPage({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const user = await requireRole("technician", "supervisor", "hq");
  const { locale, t: d } = await getI18n();
  // Super Admin chooses which role's version of this screen to use
  const me = { ...user, role: screenRole(user, (await searchParams).as, ["supervisor", "technician", "hq"]) };
  const tabs = <RoleTabs me={user} path="/diagnosis" current={me.role} roles={["supervisor", "technician", "hq"]} labels={d.roles} title={d.shell.useAs} />;
  const supabase = await createClient();

  let q = supabase.from("tickets")
    .select("id, ticket_no, item_name, item_code, fault_category, fault_notes, warranty_provisional, no_invoice, purchase_date, status, assigned_technician, branches(name)")
    .in("status", me.role === "hq" ? ["received_at_hq"] : STAGES)
    .order("created_at");
  // Technicians work only on tickets assigned to them; with supervisor assignment off they also see tickets waiting to be taken
  const selfAssign = me.role === "technician" && !(await loadWorkflow(supabase)).supervisor_assign;
  if (me.role === "technician" && !user.fullAccess) {
    q = selfAssign ? q.or(`assigned_technician.eq.${me.userId},status.eq.received_at_hq`) : q.eq("assigned_technician", me.userId);
  }
  const { data: tickets } = await q;

  const ids = (tickets ?? []).map((t) => t.id);
  const { data: diags } = ids.length && me.role !== "hq"
    ? await supabase.from("diagnoses").select("ticket_id, fault_found, warranty_decision, override_requested, override_reason, decided_at, technician").in("ticket_id", ids)
    : { data: [] };
  const diagBy = new Map((diags ?? []).map((d) => [d.ticket_id, d]));

  // Technician names: HQ can't read profiles, so read them server-side (names only)
  const { data: techs } = await createAdminClient().from("profiles").select("id, full_name").eq("role", "technician").eq("active", true).order("full_name");
  const techName = new Map((techs ?? []).map((t) => [t.id, t.full_name]));

  const jobs: Job[] = (tickets ?? []).map((t) => {
    const d = diagBy.get(t.id);
    return {
      id: t.id, ticketNo: t.ticket_no, itemName: t.item_name, itemCode: t.item_code,
      branchName: (t.branches as unknown as { name: string } | null)?.name ?? "—",
      fault: t.fault_category, faultNotes: t.fault_notes, provisional: t.warranty_provisional, noInvoice: t.no_invoice,
      purchaseDate: t.purchase_date, status: t.status,
      technician: t.assigned_technician ? techName.get(t.assigned_technician) ?? "—" : null,
      overridePending: !!d && d.override_requested && !d.decided_at,
      overrideMine: !!d && d.technician === me.userId,
      overrideReason: d?.override_reason ?? null,
      decision: d?.warranty_decision ?? null,
      finding: d?.fault_found ?? null,
    };
  });

  // Repair cost items linked to these products (all of them for the Super Admin's list)
  const codes = [...new Set((tickets ?? []).map((t) => t.item_code).filter(Boolean))] as string[];
  const { data: costRows } = user.isAdmin
    ? await supabase.from("item_cost_links").select("id, item_code, cost_item_code, cost_item_name, price, price_source, price_synced_at").order("item_code")
    : codes.length
      ? await supabase.from("item_cost_links").select("id, item_code, cost_item_code, cost_item_name, price, price_source, price_synced_at").in("item_code", codes)
      : { data: [] };
  const links = (costRows ?? []).map((r) => ({
    id: r.id, itemCode: r.item_code, costCode: r.cost_item_code, costName: r.cost_item_name,
    price: r.price === null ? null : Number(r.price), source: r.price_source, syncedAt: r.price_synced_at,
  }));
  const { data: catCosts } = await supabase.from("fault_categories").select("name, erp_item_name, cost").not("cost", "is", null);
  const categoryCosts = Object.fromEntries((catCosts ?? []).map((c) => [c.name, { name: c.erp_item_name || c.name, price: Number(c.cost) }]));
  const costs: Record<string, { name: string; price: number }[]> = {};
  for (const l of links) if (l.price !== null && codes.includes(l.itemCode)) (costs[l.itemCode] ??= []).push({ name: l.costName, price: l.price });

  return (
    <>
      {tabs}
    <DiagnosisPanel locale={locale} role={me.role} jobs={jobs}
      selfAssign={selfAssign}
      technicians={(techs ?? []).filter((t) => !selfAssign || t.id === me.userId).map((t) => ({ id: t.id, name: t.full_name }))} costs={costs} categoryCosts={categoryCosts} />
      {user.isAdmin && <div className="mt-6"><CostLinksPanel locale={locale} links={links} /></div>}
    </>
  );
}
