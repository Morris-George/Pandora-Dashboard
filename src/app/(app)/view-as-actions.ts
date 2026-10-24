"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession, type AppRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const ROLES = ["associate", "manager", "courier", "hq", "technician", "supervisor", "cs", "finance", "ops", "admin"] as const;

// Super Admin: see the system as another role ("admin" = back to full access)
export async function viewAs(role: AppRole): Promise<{ error?: string }> {
  const me = await requireSession();
  if (!me.isAdmin) return { error: "denied" };
  const r = z.enum(ROLES).safeParse(role);
  if (!r.success) return { error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_acting_role", { r: r.data });
  if (error) return { error: "failed" };
  revalidatePath("/", "layout");
  return {};
}
