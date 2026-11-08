"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

// The customer taps "confirm" on the receipt link (no sign-in: the tracking token is the key). Saved once.
export async function confirmMemo(token: string, kind: "intake" | "pickup"): Promise<{ error?: string; at?: string }> {
  if (!/^[0-9a-f]{32}$/.test(token) || (kind !== "intake" && kind !== "pickup")) return { error: "invalid" };
  const col = kind === "intake" ? "customer_confirmed_intake_at" : "customer_confirmed_pickup_at";
  const db = createAdminClient();
  let q = db.from("tickets").update({ [col]: new Date().toISOString() }).eq("tracking_token", token).is(col, null).neq("status", "draft");
  if (kind === "pickup") q = q.in("status", ["collected", "closed"]);
  const { error } = await q;
  if (error) return { error: "failed" };
  const { data } = await db.from("tickets").select(col).eq("tracking_token", token).maybeSingle();
  revalidatePath(`/memo/${token}`);
  const at = (data as Record<string, string | null> | null)?.[col];
  return at ? { at } : { error: "failed" };
}
