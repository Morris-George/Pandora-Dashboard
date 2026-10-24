"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { EXCEPTIONS, type ExceptionTarget } from "./exceptions";

export async function exceptionMove(ticketId: string, to: ExceptionTarget, reason: string): Promise<{ error?: string }> {
  await requireSession();
  const p = z.object({ id: z.string().uuid(), to: z.enum(EXCEPTIONS), reason: z.string().trim().max(1000) })
    .safeParse({ id: ticketId, to, reason });
  if (!p.success) return { error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("transition_ticket", { p_ticket: p.data.id, p_to: p.data.to, p_reason: p.data.reason || null });
  if (error) return { error: error.message.includes("reason") ? "reason" : error.message.includes("may not") ? "denied" : "failed" };
  revalidatePath(`/tickets/${p.data.id}`);
  return {};
}
