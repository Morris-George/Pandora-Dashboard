"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type LookupState = { error?: string };

// Public: ticket number + the customer's mobile number → the customer's tracking link
export async function lookup(_prev: LookupState, form: FormData): Promise<LookupState> {
  const p = z.object({ ticketNo: z.string().trim().min(3).max(20), mobile: z.string().transform((v) => v.replace(/\D/g, "")).pipe(z.string().min(9).max(15)) })
    .safeParse({ ticketNo: form.get("ticketNo"), mobile: form.get("mobile") });
  if (!p.success) return { error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("track_lookup", { p_ticket_no: p.data.ticketNo, p_last4: p.data.mobile });
  if (error) return { error: error.message.includes("too many") ? "throttled" : "failed" };
  if (!data) return { error: "notFound" };
  redirect(`/track/${data}`);
}

export async function respond(token: string, last4: string, approve: boolean, reason: string): Promise<{ error?: string }> {
  const p = z.object({ token: z.string().regex(/^[0-9a-f]{32}$/), last4: z.string().regex(/^\d{4}$/), reason: z.string().max(500) })
    .safeParse({ token, last4: last4.trim(), reason: reason.trim() });
  if (!p.success) return { error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("track_respond", { p_token: p.data.token, p_last4: p.data.last4, p_approve: approve, p_reason: p.data.reason });
  if (error) {
    const m = error.message;
    return { error: m.includes("too many") ? "throttled" : m.includes("identity") ? "identity" : m.includes("no quote") ? "stale" : "failed" };
  }
  return {};
}
