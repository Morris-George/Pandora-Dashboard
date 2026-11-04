import { requireRole } from "@/lib/auth";
import { RoleTabs, screenRole } from "@/components/role-tabs";
import { getI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { PickupPanel, type PickupJob } from "./pickup-panel";
import { waKind, waLink, waMessage, type WaTemplates } from "@/lib/whatsapp";

export const metadata = { title: "Pandora Maintenance" };

export default async function PickupPage({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const user = await requireRole("associate", "manager");
  const { locale, t: d } = await getI18n();
  // Super Admin chooses which role's version of this screen to use
  const me = { ...user, role: screenRole(user, (await searchParams).as, ["manager"]) };
  const tabs = <RoleTabs me={user} path="/pickup" current={me.role} roles={["manager"]} labels={d.roles} title={d.shell.useAs} />;
  const supabase = await createClient();

  // RLS limits this to the user's branches
  const { data: tickets } = await supabase.from("tickets")
    .select("id, ticket_no, item_name, item_code, status, customer_id, warranty_final, warranty_provisional, tracking_token, branches(name)")
    .in("status", ["ready_for_pickup", "uncollected"]);
  const ids = (tickets ?? []).map((t) => t.id);

  const [{ data: hist }, { data: customers }, dues, { data: waTpl }] = await Promise.all([
    ids.length ? supabase.from("status_history").select("ticket_id, to_status, at").in("ticket_id", ids).in("to_status", ["ready_for_pickup", "quote_rejected", "unrepairable"]) : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("customers").select("id, full_name, mobile").in("id", (tickets ?? []).map((t) => t.customer_id)) : Promise.resolve({ data: [] }),
    Promise.all(ids.map(async (id) => [id, Number((await supabase.rpc("amount_due", { p_ticket: id })).data ?? 0)] as [string, number])),
    supabase.from("app_settings").select("value").eq("key", "wa_templates").maybeSingle(),
  ]);
  const due = new Map(dues);
  const cust = new Map((customers ?? []).map((c) => [c.id, c]));

  const jobs: PickupJob[] = (tickets ?? []).map((t) => {
    const h = (hist ?? []).filter((x) => x.ticket_id === t.id);
    const ready = h.filter((x) => x.to_status === "ready_for_pickup").sort((a, b) => b.at.localeCompare(a.at))[0];
    const c = cust.get(t.customer_id);
    return {
      id: t.id, ticketNo: t.ticket_no, itemName: t.item_name, itemCode: t.item_code, status: t.status,
      branchName: (t.branches as unknown as { name: string } | null)?.name ?? "—",
      customer: c?.full_name ?? "—",
      // Show only the start of the number; staff ask the customer for the last 4 digits
      mobileHint: c?.mobile ? `${c.mobile.slice(0, 3)}•••••••` : "",
      readyAt: ready?.at ?? null,
      outcome: (h.some((x) => x.to_status === "unrepairable") ? "unrepairable" : h.some((x) => x.to_status === "quote_rejected") ? "rejected" : "repaired") as PickupJob["outcome"],
      warranty: t.warranty_final ?? t.warranty_provisional,
      due: due.get(t.id) ?? 0,
      // "Ready for pickup" (or reminder) message from the store's WhatsApp
      waHref: c?.mobile ? waLink(c.mobile, waMessage(waKind(t.status), {
        name: c.full_name ?? "", ticketNo: t.ticket_no, item: t.item_name,
        store: (t.branches as unknown as { name: string } | null)?.name ?? "", link: `${process.env.APP_BASE_URL ?? ""}/t/${t.tracking_token.slice(0, 10)}`,
      }, (waTpl?.value ?? {}) as WaTemplates)) : null,
    };
  }).sort((a, b) => (a.readyAt ?? "").localeCompare(b.readyAt ?? ""));

  return <>{tabs}<PickupPanel locale={locale} role={me.role} jobs={jobs} /></>;
}
