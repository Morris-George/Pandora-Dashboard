"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getI18n } from "@/lib/i18n";
import { createAdminClient } from "@/lib/supabase/admin";
import { erpConfigured, getErpUsers } from "@/lib/erpnext";
import { runErpSync } from "@/lib/erp-sync";

export type LoginState = { error?: string };

export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  const { t } = await getI18n();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: t.login.empty };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // One generic message so the form never reveals whether an account exists
  if (error) return { error: t.login.wrong };

  // ERPNext staff: refuse at once if disabled there; refresh their store in the background
  const { data: { user } } = await supabase.auth.getUser();
  const { data: prof } = user ? await createAdminClient().from("profiles").select("source").eq("id", user.id).single() : { data: null };
  if (prof?.source === "erpnext" && erpConfigured()) {
    const erp = (await getErpUsers([email]).catch(() => null))?.get(email);
    if (erp && !erp.enabled) {
      after(() => runErpSync("login", email));
      await supabase.auth.signOut();
      redirect("/login?error=inactive");
    }
    after(() => runErpSync("login", email));
  }

  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
