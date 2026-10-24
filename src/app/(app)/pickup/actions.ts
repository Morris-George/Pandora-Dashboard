"use server";

import { after } from "next/server";
import { flushEmails } from "@/lib/email";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { erpConfigured, findInvoiceByTicket, getInvoice } from "@/lib/erpnext";

type Result = { error?: string; outcome?: string };

function errorKey(message: string): string {
  if (message.includes("identity")) return "identity";
  if (message.includes("erp invoice")) return "invoice";
  if (message.includes("reason")) return "reason";
  if (message.includes("not ready") || message.includes("not allowed")) return "stale";
  return "failed";
}

const Collect = z.object({
  ticketId: z.string().uuid(),
  last4: z.string().trim().regex(/^\d{4}$/),
  erpInvoice: z.string().trim().max(60),
  collectedBy: z.string().trim().max(120),
});

export async function collect(input: z.infer<typeof Collect>): Promise<Result> {
  await requireRole("associate", "manager");
  const p = Collect.safeParse(input);
  if (!p.success) return { error: !/^\d{4}$/.test(input.last4?.trim() ?? "") ? "identity" : "invalid" };
  const c = p.data;
  const supabase = await createClient();
  // The repair invoice is issued in ERPNext: confirm it exists there before linking it to the ticket
  if (c.erpInvoice) {
    if (!erpConfigured()) return { error: "erpDown" };
    const inv = await getInvoice(c.erpInvoice).catch(() => undefined);
    if (inv === undefined) return { error: "erpDown" };
    if (!inv || inv.isReturn) return { error: "invoiceNotFound" };
  }
  after(() => flushEmails()); // send any customer email this queues
  const { data, error } = await supabase.rpc("collect_ticket", {
    p_ticket: c.ticketId, p_mobile_last4: c.last4, p_erp_invoice: c.erpInvoice,
    p_collected_by: c.collectedBy ? `Collected by: ${c.collectedBy}` : "",
  });
  if (error) return { error: errorKey(error.message) };
  revalidatePath("/pickup");
  revalidatePath("/tickets");
  return { outcome: data as string };
}

export async function markUncollected(ticketId: string, reason: string): Promise<Result> {
  await requireRole("manager");
  const supabase = await createClient();
  const { error } = await supabase.rpc("transition_ticket", {
    p_ticket: z.string().uuid().parse(ticketId), p_to: "uncollected", p_reason: reason.trim().slice(0, 1000),
  });
  if (error) return { error: errorKey(error.message) };
  revalidatePath("/pickup");
  return {};
}

export type RepairInvoice = { status: "found"; invoiceNo: string; total: number; date: string } | { status: "not_found" | "error" | "not_connected" };

// Look up the ERPNext invoice the store issued for this repair: by number, or by the ticket number in its remarks
export async function findRepairInvoice(ticketNo: string, invoiceNo: string): Promise<RepairInvoice> {
  await requireRole("associate", "manager");
  if (!erpConfigured()) return { status: "not_connected" };
  try {
    const inv = invoiceNo.trim() ? await getInvoice(invoiceNo.trim().slice(0, 60)) : await findInvoiceByTicket(ticketNo.slice(0, 30));
    return inv && !inv.isReturn ? { status: "found", invoiceNo: inv.name, total: inv.total, date: inv.postingDate } : { status: "not_found" };
  } catch {
    return { status: "error" };
  }
}
