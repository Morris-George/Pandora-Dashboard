"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Super Admin correction: move tickets to any status, with a reason (timeline + audit log)
export async function setTicketsStatus(ids: string[], to: string, reason: string): Promise<{ error?: string; changed?: number }> {
  await requireRole("admin");
  const p = z.object({ ids: z.array(z.string().uuid()).min(1).max(200), to: z.string().min(1).max(60), reason: z.string().trim().min(1).max(1000) })
    .safeParse({ ids, to, reason });
  if (!p.success) return { error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_set_status", { p_tickets: p.data.ids, p_to: p.data.to, p_reason: p.data.reason });
  if (error) return { error: "failed" };
  revalidatePath("/tickets");
  return { changed: data as number };
}
