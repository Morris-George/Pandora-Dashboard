import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// TEMPORARY diagnostics (training accounts only, no passwords): to be removed.
export async function GET(req: Request) {
  const email = (new URL(req.url).searchParams.get("e") ?? "").trim().toLowerCase();
  const env = {
    secretLen: (process.env.MAINTENANCE_SSO_SECRET ?? "").length,
    urlSet: !!process.env.NEXT_PUBLIC_SUPABASE_URL, anonLen: (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").length,
    svcLen: (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").length,
  };
  if (!email.endsWith("@training.pandoraeg.com")) return NextResponse.json({ env });
  const admin = createAdminClient();
  const { data: prof } = await admin.from("profiles").select("id, role, active, source, must_change_password, is_training").eq("email", email).maybeSingle();
  let auth: unknown = null;
  if (prof) {
    const { data } = await admin.auth.admin.getUserById(prof.id);
    const u = data?.user;
    auth = u ? { confirmed: !!u.email_confirmed_at, banned: u.banned_until ?? null, lastSignIn: u.last_sign_in_at ?? null, updated: u.updated_at } : null;
  }
  return NextResponse.json({ env, prof, auth });
}
