import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Dict } from "@/lib/i18n/dictionaries";

// Report definitions (BRD 10). Every query runs with the viewer's client, so RLS still limits
// rows to their branches; report access itself is checked by the caller via report_level_for().
export type Level = "none" | "view" | "export";
export type Cell = string | number;
export type Report = {
  summary: { label: string; value: Cell }[];
  // Optional bar chart: one bar per category
  chart?: { title: string; bars: { label: string; value: number }[]; unit?: string };
  columns: string[];
  rows: Cell[][];
};
type Ctx = { supabase: SupabaseClient; d: Dict; fmt: (s: string) => string };

const DAY = 86_400_000;
const days = (from: string, to = Date.now()) => Math.max(0, Math.floor((to - new Date(from).getTime()) / DAY));
const branchOf = (b: unknown) => (b as { name: string } | null)?.name ?? "—";
const tally = (keys: string[]) => {
  const m = new Map<string, number>();
  keys.forEach((k) => m.set(k, (m.get(k) ?? 0) + 1));
  return [...m.entries()].map(([label, value]) => ({ label, value }));
};
const OPEN = ["received_at_branch", "awaiting_dispatch", "in_transit_to_hq", "received_at_hq", "under_diagnosis",
  "awaiting_customer_approval", "in_repair", "awaiting_parts", "quality_check", "ready_to_return", "in_transit_to_branch",
  "ready_for_pickup", "uncollected"];

async function transit({ supabase, d, fmt }: Ctx): Promise<Report> {
  const r = d.reports;
  const { data } = await supabase.from("tickets")
    .select("id, ticket_no, item_name, status, updated_at, branches(name)")
    .in("status", ["in_transit_to_hq", "in_transit_to_branch"]).order("updated_at");
  const ids = (data ?? []).map((t) => t.id);
  const { data: items } = ids.length
    ? await supabase.from("batch_items").select("ticket_id, dispatch_batches(batch_no, seal_no, status)").in("ticket_id", ids)
    : { data: [] };
  const batchOf = new Map((items ?? []).map((i) => [i.ticket_id, i.dispatch_batches as unknown as { batch_no: string; seal_no: string; status: string } | null]));
  const rows = (data ?? []).map((t) => {
    const b = batchOf.get(t.id);
    return [t.ticket_no, t.item_name, branchOf(t.branches), d.status[t.status], b?.batch_no ?? "—", b?.seal_no ?? "—",
      b ? d.dispatch.batchStatus[b.status] : "—", fmt(t.updated_at), days(t.updated_at)];
  });
  return {
    summary: [
      { label: r.s.inTransit, value: rows.length },
      { label: r.s.over2Days, value: rows.filter((x) => Number(x[8]) > 2).length },
    ],
    columns: [r.c.ticket, r.c.item, r.c.branch, r.c.status, r.c.batch, r.c.seal, r.c.batchStatus, r.c.since, r.c.days],
    rows,
    chart: { title: r.chart.byBranch, bars: tally(rows.map((x) => String(x[2]))) },
  };
}

async function status({ supabase, d }: Ctx): Promise<Report> {
  const r = d.reports;
  const { data } = await supabase.from("tickets").select("status, created_at, updated_at, sla_due, branches(name)").neq("status", "draft");
  const all = data ?? [];
  const counts = new Map<string, number>();
  all.forEach((t) => counts.set(t.status, (counts.get(t.status) ?? 0) + 1));
  const closed = all.filter((t) => t.status === "closed" || t.status === "collected");
  const avgTat = closed.length ? Math.round(closed.reduce((s, t) => s + days(t.created_at, new Date(t.updated_at).getTime()), 0) / closed.length) : 0;
  const overdue = all.filter((t) => OPEN.includes(t.status) && t.sla_due && new Date(t.sla_due).getTime() < Date.now()).length;
  const open = all.filter((t) => OPEN.includes(t.status));
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => {
    const inState = all.filter((t) => t.status === s);
    const avgAge = Math.round(inState.reduce((acc, t) => acc + days(t.created_at), 0) / inState.length);
    return [d.status[s] ?? s, n, avgAge];
  });
  return {
    summary: [
      { label: r.s.total, value: all.length },
      { label: r.s.open, value: open.length },
      { label: r.s.avgTat, value: avgTat },
      { label: r.s.slaOverdue, value: overdue },
    ],
    columns: [r.c.status, r.c.count, r.c.avgAge],
    rows,
    chart: { title: r.chart.byStatus, bars: rows.map((x) => ({ label: String(x[0]), value: Number(x[1]) })) },
  };
}

async function warranty({ supabase, d }: Ctx): Promise<Report> {
  const r = d.reports;
  const { data } = await supabase.from("tickets").select("warranty_provisional, warranty_final, no_invoice, branches(name)").neq("status", "draft");
  const byBranch = new Map<string, { total: number; under: number; out: number; pending: number; noInv: number; changed: number }>();
  (data ?? []).forEach((t) => {
    const k = branchOf(t.branches);
    const x = byBranch.get(k) ?? { total: 0, under: 0, out: 0, pending: 0, noInv: 0, changed: 0 };
    const w = t.warranty_final ?? t.warranty_provisional;
    x.total++;
    if (w === "under_warranty") x.under++; else if (w === "out_of_warranty") x.out++; else x.pending++;
    if (t.no_invoice) x.noInv++;
    if (t.warranty_final && t.warranty_provisional !== "pending_assessment" && t.warranty_final !== t.warranty_provisional) x.changed++;
    byBranch.set(k, x);
  });
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
  const rows = [...byBranch.entries()].map(([b, x]) => [b, x.total, x.under, x.out, x.pending, pct(x.under, x.under + x.out), x.noInv, x.changed]);
  const tot = [...byBranch.values()].reduce((a, x) => ({ under: a.under + x.under, out: a.out + x.out, changed: a.changed + x.changed }), { under: 0, out: 0, changed: 0 });
  return {
    summary: [
      { label: r.s.warrantyRatio, value: pct(tot.under, tot.under + tot.out) },
      { label: r.s.overrides, value: tot.changed },
    ],
    chart: { title: r.chart.underPct, unit: "%", bars: [...byBranch.entries()].map(([b, x]) => ({ label: b, value: x.under + x.out ? Math.round((x.under / (x.under + x.out)) * 100) : 0 })) },
    columns: [r.c.branch, r.c.count, d.warranty.under_warranty, d.warranty.out_of_warranty, d.warranty.pending_assessment, r.c.ratio, r.c.noInvoice, r.c.overridden],
    rows,
  };
}

async function revenue({ supabase, d, fmt }: Ctx): Promise<Report> {
  const r = d.reports;
  const { data } = await supabase.from("quotations").select("ticket_id, subtotal, tax, total, status, sent_at, tickets(ticket_no, branches(name))").order("sent_at", { ascending: false });
  const { data: parts } = await supabase.from("parts_consumption").select("qty, unit_cost");
  const money = (n: number) => Math.round(n * 100) / 100;
  const q = data ?? [];
  const sum = (s: string[]) => money(q.filter((x) => s.includes(x.status)).reduce((a, x) => a + Number(x.total), 0));
  const partsCost = money((parts ?? []).reduce((a, p) => a + Number(p.qty) * Number(p.unit_cost ?? 0), 0));
  const rows = q.map((x) => {
    const t = x.tickets as unknown as { ticket_no: string; branches: unknown } | null;
    return [t?.ticket_no ?? "—", branchOf(t?.branches), x.sent_at ? fmt(x.sent_at) : "—", r.quote[x.status] ?? x.status,
      money(Number(x.subtotal)), money(Number(x.tax)), money(Number(x.total))];
  });
  return {
    summary: [
      { label: r.s.approvedRevenue, value: sum(["approved"]) },
      { label: r.s.pendingQuotes, value: sum(["sent"]) },
      { label: r.s.rejected, value: sum(["rejected", "expired"]) },
      { label: r.s.partsCost, value: partsCost },
    ],
    chart: { title: r.chart.byQuoteStatus, bars: ["approved", "sent", "rejected", "expired"].map((k) => ({ label: r.quote[k], value: sum([k]) })).filter((b) => b.value > 0) },
    columns: [r.c.ticket, r.c.branch, r.c.sent, r.c.quoteStatus, r.c.subtotal, r.c.vat, r.c.total],
    rows,
  };
}

async function pickup({ supabase, d, fmt }: Ctx): Promise<Report> {
  const r = d.reports;
  const { data } = await supabase.from("tickets").select("id, ticket_no, item_name, status, branches(name)").in("status", ["ready_for_pickup", "uncollected"]);
  const ids = (data ?? []).map((t) => t.id);
  // Age from the moment the item became ready for pickup
  const { data: hist } = ids.length
    ? await supabase.from("status_history").select("ticket_id, at").eq("to_status", "ready_for_pickup").in("ticket_id", ids)
    : { data: [] };
  const readyAt = new Map((hist ?? []).map((h) => [h.ticket_id, h.at]));
  const rows = (data ?? []).map((t) => {
    const at = readyAt.get(t.id);
    const age = at ? days(at) : 0;
    const bucket = age <= 7 ? "0–7" : age <= 30 ? "8–30" : age <= 90 ? "31–90" : "90+";
    return [t.ticket_no, t.item_name, branchOf(t.branches), d.status[t.status], at ? fmt(at) : "—", age, bucket];
  }).sort((a, b) => Number(b[5]) - Number(a[5]));
  return {
    summary: [
      { label: r.s.waiting, value: rows.length },
      { label: r.s.over30, value: rows.filter((x) => Number(x[5]) > 30).length },
      { label: r.s.uncollected, value: (data ?? []).filter((t) => t.status === "uncollected").length },
    ],
    chart: { title: r.chart.byAge, bars: ["0–7", "8–30", "31–90", "90+"].map((k) => ({ label: k, value: rows.filter((x) => x[6] === k).length })) },
    columns: [r.c.ticket, r.c.item, r.c.branch, r.c.status, r.c.readySince, r.c.days, r.c.bucket],
    rows,
  };
}

async function productivity({ supabase, d }: Ctx): Promise<Report> {
  const r = d.reports;
  const { data: tickets } = await supabase.from("tickets").select("id, assigned_technician, status").not("assigned_technician", "is", null);
  const { data: hist } = await supabase.from("status_history").select("ticket_id, to_status, at, reason").in("to_status", ["under_diagnosis", "quality_check", "ready_to_return", "in_repair"]);
  // Names only, read server-side (branch roles can't read profiles)
  const { data: techs } = await createAdminClient().from("profiles").select("id, full_name").eq("role", "technician");
  const name = new Map((techs ?? []).map((t) => [t.id, t.full_name]));
  const evts = hist ?? [];
  const per = new Map<string, { assigned: number; active: number; done: number; reworks: number; hours: number[] }>();
  (tickets ?? []).forEach((t) => {
    const k = t.assigned_technician as string;
    const x = per.get(k) ?? { assigned: 0, active: 0, done: 0, reworks: 0, hours: [] };
    x.assigned++;
    if (["under_diagnosis", "in_repair", "awaiting_parts", "quality_check"].includes(t.status)) x.active++;
    const mine = evts.filter((e) => e.ticket_id === t.id);
    const start = mine.find((e) => e.to_status === "under_diagnosis");
    const qc = mine.filter((e) => e.to_status === "quality_check").sort((a, b) => a.at.localeCompare(b.at));
    if (mine.some((e) => e.to_status === "ready_to_return")) x.done++;
    // QC failure = back to in_repair with a reason after a QC
    x.reworks += mine.filter((e) => e.to_status === "in_repair" && e.reason && qc.some((q) => q.at < e.at)).length;
    if (start && qc[0]) x.hours.push((new Date(qc[0].at).getTime() - new Date(start.at).getTime()) / 3_600_000);
    per.set(k, x);
  });
  const rows = [...per.entries()].map(([id, x]) => [
    name.get(id) ?? "—", x.assigned, x.active, x.done, x.reworks,
    x.hours.length ? Math.round((x.hours.reduce((a, b) => a + b, 0) / x.hours.length) * 10) / 10 : "—",
  ]);
  return {
    summary: [
      { label: r.s.technicians, value: per.size },
      { label: r.s.completed, value: rows.reduce((a, x) => a + Number(x[3]), 0) },
    ],
    chart: { title: r.chart.completedByTech, bars: rows.map((x) => ({ label: String(x[0]), value: Number(x[3]) })) },
    columns: [d.roles.technician, r.c.assigned, r.c.active, r.c.completed, r.c.reworks, r.c.avgHours],
    rows,
  };
}

async function audit({ supabase, fmt }: Ctx): Promise<Report> {
  const { data } = await supabase.from("audit_log").select("at, role, entity, entity_id, action, user_id").order("at", { ascending: false }).limit(300);
  const { data: people } = await createAdminClient().from("profiles").select("id, full_name");
  const name = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  return { summary: [], columns: [], rows: (data ?? []).map((a) => [fmt(a.at), a.user_id ? name.get(a.user_id) ?? "—" : "system", a.role ?? "—", a.entity, a.action, a.entity_id ?? ""]) };
}

const BUILDERS: Record<string, (c: Ctx) => Promise<Report>> = { transit, status, warranty, revenue, pickup, productivity, audit };

export async function buildReport(key: string, supabase: SupabaseClient, d: Dict, locale: string): Promise<Report | null> {
  const fn = BUILDERS[key];
  if (!fn) return null;
  const fmt = (s: string) => new Date(s).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "short", timeStyle: "short" });
  const rep = await fn({ supabase, d, fmt });
  if (key === "audit") rep.columns = [d.reports.c.when, d.reports.c.user, d.reports.c.role, d.reports.c.entity, d.reports.c.action, d.reports.c.ref];
  return rep;
}

export async function levelFor(supabase: SupabaseClient, key: string): Promise<Level> {
  const { data } = await supabase.rpc("report_level_for", { r: key });
  return (data as Level) ?? "none";
}

export async function toXlsx(rep: Report, title: string, locale: string): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Pandora Maintenance";
  wb.created = new Date();
  const rtl = locale === "ar";
  // Guard against spreadsheet formula injection in text cells
  const safe = (v: Cell) => (typeof v === "string" && /^[=+\-@]/.test(v) ? `'${v}` : v);

  const ws = wb.addWorksheet(title.replace(/[*?:\\/[\]]/g, "-").slice(0, 31), { views: [{ state: "frozen", ySplit: 1, rightToLeft: rtl }] });
  ws.addRow(rep.columns);
  rep.rows.forEach((r) => ws.addRow(r.map(safe)));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1C1917" } };
  if (rep.columns.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: rep.columns.length } };
  rep.columns.forEach((c, i) => {
    const longest = Math.max(c.length, ...rep.rows.map((r) => String(r[i] ?? "").length));
    ws.getColumn(i + 1).width = Math.min(60, Math.max(10, longest + 2));
  });

  if (rep.summary.length) {
    const sum = wb.addWorksheet(rtl ? "ملخص" : "Summary", { views: [{ rightToLeft: rtl }] });
    sum.addRow([title]).font = { bold: true, size: 14 };
    sum.addRow([new Date().toLocaleString(rtl ? "ar-EG" : "en-GB")]);
    sum.addRow([]);
    rep.summary.forEach((x) => sum.addRow([x.label, x.value]));
    sum.getColumn(1).width = 36;
    sum.getColumn(2).width = 18;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
