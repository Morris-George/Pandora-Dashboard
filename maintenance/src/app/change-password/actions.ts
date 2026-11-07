"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";

export type PwdState = { error?: string };

export async function changePassword(_prev: PwdState, form: FormData): Promise<PwdState> {
  await requireSession();
  const { t } = await getI18n();
  const pwd = String(form.get("password") ?? "");
  if (pwd.length < 10) return { error: t.pwd.short };
  if (pwd !== String(form.get("confirm") ?? "")) return { error: t.pwd.mismatch };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: pwd });
  if (error) return { error: t.pwd.failed };
  await supabase.rpc("password_changed");
  redirect("/");
}
