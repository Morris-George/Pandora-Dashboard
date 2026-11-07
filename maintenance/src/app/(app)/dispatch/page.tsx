import { filterStores } from "@/lib/store-filter";
import { requireRole } from "@/lib/auth";
import { RoleTabs, screenRole } from "@/components/role-tabs";
import { getI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { DispatchPanel, type BatchRow, type ItemRow } from "./dispatch-panel";

export const metadata = { title: "Pandora Maintenance" };

type Joined<T> = T | null;

export default async function DispatchPage({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const user = await requireRole("associate", "manager", "courier", "delivery", "hq", "technician", "supervisor", "ops");
  const { locale, t: d } = await getI18n();
  // Super Admin chooses which role's version of this screen to use
  const me = { ...user, role: screenRole(user, (await searchParams).as, ["manager", "courier", "delivery", "hq", "technician", "supervisor", "ops"]) };
  const tabs = <RoleTabs me={user} path="/dispatch" current={me.role} roles={["manager", "courier", "delivery", "hq", "technician", "supervisor", "ops"]} labels={d.roles} title={d.shell.useAs} />;
  const supabase = await createClient();
  const isBranch = me.role === "associate" || me.role === "manager";

  // RLS already limits branch roles to their own branches
  const [{ data: packable }, { data: returnable }, { data: batches }, { data: wf }] = await Promise.all([
    isBranch
      ? supabase.from("tickets").select("id, ticket_no, item_name, branch_id").eq("status", "received_at_branch").order("created_at")
      : Promise.resolve({ data: [] }),
    me.role === "supervisor"
      ? supabase.from("tickets").select("id, ticket_no, item_name, branch_id").eq("status", "ready_to_return").order("created_at")
      : Promise.resolve({ data: [] }),
    supabase.from("dispatch_batches")
      .select("id, batch_no, direction, branch_id, seal_no, status, sent_by, created_at, courier_id, picked_up_at, branches(name), batch_items(scanned_in, tickets(ticket_no, item_name, status))")
      .order("created_at", { ascending: false }).limit(50),
    supabase.from("app_settings").select("value").eq("key", "workflow").maybeSingle(),
  ]);
  // Admin → Workflow: with the area manager step off, the receiver scans the bag directly
  const flow = (wf?.value ?? {}) as { area_manager?: boolean; courier_out?: boolean; courier_return?: boolean };
  const areaManager = flow.area_manager !== false;
  // Per trip: the Courier picks the bag up when that switch is on, otherwise the Area Manager (who then only follows it)

  // Branch names for the return grouping (supervisor sees all branches)
  const { data: branchList } = await supabase.from("branches").select("id, name, is_hq, pickup_out, pickup_return").eq("active", true).order("name");
  const branchName = new Map((branchList ?? []).map((b) => [b.id, b.name]));
  // Per bag: the Courier picks it up when the trip's switch is on and the store chose the Courier (Admin → Stores), otherwise the Area Manager
  const storeOf = new Map((branchList ?? []).map((b) => [b.id, b]));
  const pickerFor = (branchId: string, direction: "outbound" | "return"): "courier" | "delivery" => {
    const s = storeOf.get(branchId);
    const on = direction === "outbound" ? flow.courier_out !== false : flow.courier_return !== false;
    return on && (direction === "outbound" ? s?.pickup_out : s?.pickup_return) !== "area_manager" ? "delivery" : "courier";
  };

  const toItem = (t: { id: string; ticket_no: string; item_name: string; branch_id: string }): ItemRow => ({
    id: t.id, ticketNo: t.ticket_no, itemName: t.item_name, branchId: t.branch_id, branchName: branchName.get(t.branch_id) ?? "—",
  });

  const rows: BatchRow[] = (batches ?? []).map((b) => ({
    id: b.id, batchNo: b.batch_no, direction: b.direction, branchId: b.branch_id, branchName: (b.branches as unknown as Joined<{ name: string }>)?.name ?? "—",
    seal: b.seal_no, status: b.status, picker: pickerFor(b.branch_id, b.direction), mine: b.sent_by === me.userId, createdAt: b.created_at, pickedAt: b.picked_up_at,
    items: ((b.batch_items ?? []) as unknown as { scanned_in: boolean; tickets: Joined<{ ticket_no: string; item_name: string; status: string }> }[])
      .map((i) => ({ ticketNo: i.tickets?.ticket_no ?? "—", itemName: i.tickets?.item_name ?? "", scanned: i.scanned_in,
        pending: !i.scanned_in && (i.tickets?.status ?? "").startsWith("in_transit") })),
  }));

  return (
    <>
      {tabs}
    <DispatchPanel
      locale={locale}
      role={me.role}
      myBranches={(await filterStores(me, supabase)) ?? me.branches.map((b) => ({ id: b.id, name: b.name }))}
      packable={(packable ?? []).map(toItem)}
      returnable={(returnable ?? []).map(toItem)}
      batches={rows}
      areaManager={areaManager}
      isAdmin={user.isAdmin}
    />
    </>
  );
}
