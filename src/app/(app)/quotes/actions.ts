"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Result = { error?: string };

function errorKey(message: string): string {
  if (message.includes("call reference")) return "callRef";
  if (message.includes("reason")) return "reason";
  if (message.includes("no quote") || message.includes("not allowed")) return "stale";
  return "failed";
}

const Answer = z.object({
  ticketId: z.string().uuid(),
  approve: z.boolean(),
  via: z.enum(["link", "phone_agent"]),
  callRef: z.string().trim().max(80),
  reason: z.string().trim().max(1000),
});

export async function respondQuote(input: z.infer<typeof Answer>): Promise<Result> {
  await requireRole("cs");
  const p = Answer.safeParse(input);
  if (!p.success) return { error: "invalid" };
  const a = p.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_quote", {
    p_ticket: a.ticketId, p_approve: a.approve, p_via: a.via, p_call_ref: a.callRef, p_reason: a.reason,
  });
  if (error) return { error: errorKey(error.message) };
  revalidatePath("/quotes");
  revalidatePath("/tickets");
  return {};
}

// Rejected quote: item goes back to the branch unrepaired
export async function returnUnrepaired(ticketId: string): Promise<Result> {
  await requireRole("cs");
  const supabase = await createClient();
  const { error } = await supabase.rpc("transition_ticket", { p_ticket: z.string().uuid().parse(ticketId), p_to: "ready_to_return" });
  if (error) return { error: errorKey(error.message) };
  revalidatePath("/quotes");
  return {};
}
