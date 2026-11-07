import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AppRole =
  | "associate" | "manager" | "courier" | "delivery" | "hq" | "technician"
  | "supervisor" | "cs" | "finance" | "ops" | "admin";

export type Session = {
  userId: string;
  fullName: string;
  email: string;
  role: AppRole; // the role in effect (a Super Admin "viewing as" another role gets that role)
  isAdmin: boolean; // the account is a Super Admin
  fullAccess: boolean; // Super Admin not viewing as another role: every screen and store
  viewingAs: AppRole | null;
  mustChangePassword: boolean;
  training: boolean; // training account: sees only the training store
  branches: { id: string; code: string; name: string }[];
};

// Loads the signed-in user's profile; redirects to /login if signed out or deactivated.
// cache(): layout and page share one lookup per request. getClaims() verifies the JWT
// locally (signing keys), so no Auth round trip; "active" is still checked on every request.
export const requireSession = cache(async (): Promise<Session> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/login");
  const user = { id: userId };

  const [{ data: profile }, { data: links }, { data: twoStep }] = await Promise.all([
    supabase.from("profiles").select("full_name, email, role, acting_role, active, must_change_password, is_training").eq("id", user.id).single(),
    supabase.from("user_branches").select("branches(id, code, name)").eq("user_id", user.id),
    supabase.from("app_settings").select("value").eq("key", "admin_two_step").maybeSingle(),
  ]);
  if (!profile || !profile.active) {
    await supabase.auth.signOut();
    redirect("/login?error=inactive");
  }

  const isAdmin = profile.role === "admin";
  // Super Admins must finish two-step login (authenticator code) before anything else
  if (isAdmin && twoStep?.value !== false && data?.claims?.aal !== "aal2") redirect("/mfa");
  const viewingAs = isAdmin ? ((profile.acting_role as AppRole | null) ?? null) : null;
  const role = (viewingAs ?? profile.role) as AppRole;
  const fullAccess = isAdmin && !viewingAs;
  const base = { userId: user.id, fullName: profile.full_name, email: profile.email, role, isAdmin, fullAccess, viewingAs, mustChangePassword: profile.must_change_password, training: !!profile.is_training };
  // Super Admin works across every store (also when viewing as a store role)
  if (isAdmin) {
    const { data: all } = await supabase.from("branches").select("id, code, name").eq("active", true).eq("is_hq", false).order("name");
    return { ...base, branches: all ?? [] };
  }

  const branches = (links ?? [])
    .map((l) => l.branches as unknown as Session["branches"][number] | null)
    .filter((b): b is Session["branches"][number] => !!b);

  return { ...base, branches };
});

export async function requireRole(...roles: AppRole[]): Promise<Session> {
  const session = await requireSession();
  if (!roles.includes(session.role) && !session.fullAccess) redirect("/?denied=1");
  return session;
}
