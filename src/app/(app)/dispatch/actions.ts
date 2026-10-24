"use server";

import { after } from "next/server";
import { flushEmails } from "@/lib/email";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Result = { error?: string; batchNo?: string };

// Map database exceptions to dictionary error keys
function errorKey(message: string): string {
  if (message.includes("SoD")) return "sod";
  if (message.includes("seal")) return "seal";
  if (message.includes("at least one")) return "empty";
  if (message.includes("every ticket")) return "stale";
  if (message.includes("not in transit") || message.includes("not awaiting")) return "stale";
  return "failed";
}

const done = (batchNo?: string): Result => {
  revalidatePath("/dispatch");
  revalidatePath("/tickets");
  return { batchNo };
};

const NewBatch = z.object({
  branchId: z.string().uuid(),
  seal: z.string().trim().min(1).max(40),
  ticketIds: z.array(z.string().uuid()).min(1).max(100),
});

export async function createOutbound(input: z.infer<typeof NewBatch>): Promise<Result> {
  await requireRole("associate", "manager");
  const p = NewBatch.safeParse(input);
  if (!p.success) return { error: !input.seal?.trim() ? "seal" : "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_outbound_batch", {
    p_branch: p.data.branchId, p_seal: p.data.seal, p_tickets: p.data.ticketIds,
  });
  if (error) return { error: errorKey(error.message) };
  return done(data?.batch_no);
}

export async function createReturn(input: z.infer<typeof NewBatch>): Promise<Result> {
  await requireRole("supervisor");
  const p = NewBatch.safeParse(input);
  if (!p.success) return { error: !input.seal?.trim() ? "seal" : "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_return_batch", {
    p_branch: p.data.branchId, p_seal: p.data.seal, p_tickets: p.data.ticketIds,
  });
  if (error) return { error: errorKey(error.message) };
  return done(data?.batch_no);
}

export async function approveBatch(batchId: string): Promise<Result> {
  await requireRole("manager");
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_batch", { p_batch: z.string().uuid().parse(batchId) });
  if (error) return { error: errorKey(error.message) };
  return done();
}

export async function receiveBatch(batchId: string, scanned: string[]): Promise<Result> {
  await requireRole("hq", "associate", "manager");
  const list = z.array(z.string().trim().min(1).max(40)).max(100).safeParse(scanned);
  if (!list.success) return { error: "invalid" };
  const supabase = await createClient();
  after(() => flushEmails()); // send any customer email this queues
  const { error } = await supabase.rpc("receive_batch", { p_batch: z.string().uuid().parse(batchId), p_scanned: list.data });
  if (error) return { error: errorKey(error.message) };
  return done();
}
