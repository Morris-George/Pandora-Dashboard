"use server";

import { after } from "next/server";
import { flushEmails } from "@/lib/email";
import { alertItemLost, alertShortBatch } from "@/lib/alerts";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Result = { error?: string; batchNo?: string; awb?: string; batchId?: string };

// Map database exceptions to dictionary error keys
function errorKey(message: string): string {
  if (message.includes("scan every item")) return "scanAll";
  if (message.includes("not collected this batch")) return "notCollected";
  if (message.includes("SoD")) return "sod";
  if (message.includes("does not match")) return "sealMismatch";
  if (message.includes("already collected")) return "stale";
  if (message.includes("seal")) return "seal";
  if (message.includes("at least one")) return "empty";
  if (message.includes("every ticket")) return "stale";
  if (message.includes("not in transit") || message.includes("not awaiting")) return "stale";
  return "failed";
}

const done = (batchNo?: string, awb?: string, batchId?: string): Result => {
  revalidatePath("/dispatch");
  revalidatePath("/tickets");
  return { batchNo, awb, batchId };
};

const NewBatch = z.object({
  branchId: z.string().uuid(),
  seal: z.string().trim().max(40), // empty: the database makes the AWB number (AWB-<store>-000001)
  ticketIds: z.array(z.string().uuid()).min(1).max(100),
});

export async function createOutbound(input: z.infer<typeof NewBatch>): Promise<Result> {
  await requireRole("associate", "manager");
  const p = NewBatch.safeParse(input);
  if (!p.success) return { error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_outbound_batch", {
    p_branch: p.data.branchId, p_seal: p.data.seal, p_tickets: p.data.ticketIds,
  });
  if (error) return { error: errorKey(error.message) };
  return done(data?.batch_no, data?.seal_no, data?.id);
}

export async function createReturn(input: z.infer<typeof NewBatch>): Promise<Result> {
  await requireRole("supervisor");
  const p = NewBatch.safeParse(input);
  if (!p.success) return { error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_return_batch", {
    p_branch: p.data.branchId, p_seal: p.data.seal, p_tickets: p.data.ticketIds,
  });
  if (error) return { error: errorKey(error.message) };
  return done(data?.batch_no, data?.seal_no, data?.id);
}

export async function approveBatch(batchId: string): Promise<Result> {
  await requireRole("manager");
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_batch", { p_batch: z.string().uuid().parse(batchId) });
  if (error) return { error: errorKey(error.message) };
  return done();
}

// Super Admin override: approve a batch they packed themselves, with a reason (checked in the RPC)
export async function adminApproveBatch(batchId: string, reason: string): Promise<Result> {
  const me = await requireSession();
  if (!me.isAdmin) return { error: "forbidden" };
  const r = z.string().trim().min(1).max(300).safeParse(reason);
  if (!r.success) return { error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_approve_batch", { p_batch: z.string().uuid().parse(batchId), p_reason: r.data });
  if (error) return { error: errorKey(error.message) };
  return done();
}

// Courier confirms collecting a sealed batch (seal number must match)
export async function courierPickup(batchId: string, seal: string, scanned: string[]): Promise<Result> {
  await requireRole("courier");
  const list = z.array(z.string().trim().min(1).max(40)).max(100).safeParse(scanned);
  if (!list.success) return { error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("courier_pickup", { p_batch: z.string().uuid().parse(batchId), p_seal: seal.trim().slice(0, 40), p_scanned: list.data });
  if (error) return { error: errorKey(error.message) };
  return done();
}

export async function receiveBatch(batchId: string, scanned: string[]): Promise<Result> {
  await requireRole("hq", "technician", "supervisor", "associate", "manager");
  const list = z.array(z.string().trim().min(1).max(40)).max(100).safeParse(scanned);
  if (!list.success) return { error: "invalid" };
  const supabase = await createClient();
  after(() => flushEmails()); // send any customer email this queues
  const { data: b, error } = await supabase.rpc("receive_batch", { p_batch: z.string().uuid().parse(batchId), p_scanned: list.data });
  if (error) return { error: errorKey(error.message) };
  if (b?.status === "incident") after(() => alertShortBatch(batchId)); // email the lost-item alert list
  return done();
}

// Incident batch: an item that arrived later is scanned in on its own
export async function receiveLateItem(batchId: string, ticketNo: string): Promise<Result> {
  await requireSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("receive_late_item", { p_batch: z.string().uuid().parse(batchId), p_ticket_no: z.string().trim().min(1).max(40).parse(ticketNo) });
  if (error) return { error: error.message.includes("not pending") ? "notPending" : errorKey(error.message) };
  return done();
}

// Incident batch: Ops confirms an item is lost (ticket → lost_in_transit)
export async function markItemLost(batchId: string, ticketNo: string, reason: string): Promise<Result> {
  await requireSession();
  const r = z.string().trim().min(1).max(300).safeParse(reason);
  if (!r.success) return { error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_item_lost", { p_batch: z.string().uuid().parse(batchId), p_ticket_no: ticketNo, p_reason: r.data });
  if (error) return { error: errorKey(error.message) };
  const { data: tk } = await supabase.from("tickets").select("id").eq("ticket_no", ticketNo).maybeSingle();
  if (tk) after(() => alertItemLost(tk.id, r.data));
  return done();
}
