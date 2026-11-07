import { after, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { secretOk } from "@/lib/sso";
import { createAdminClient } from "@/lib/supabase/admin";
import { erpConfigured, getErpUsers } from "@/lib/erpnext";
import { runErpSync } from "@/lib/erp-sync";

// Called by the dashboard site's sign-in (server to server, secret header). Checks the Maintenance email + password
// and returns the session for /sso to install. Never reveals why a sign-in failed.
export async function POST(req: Request) {
  if (!secretOk(req)) return NextResponse.json({ ok: false }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!email || !password) return NextResponse.json({ ok: false }, { status: 401 });

  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) return NextResponse.json({ ok: false }, { status: 401 });

  const admin = createAdminClient();
  const { data: prof } = await admin.from("profiles").select("full_name, active, source").eq("id", data.user.id).single();
  if (!prof || !prof.active) return NextResponse.json({ ok: false, inactive: true }, { status: 403 });

  // ERPNext staff: refuse at once if disabled there; refresh their store in the background (same as the old sign-in page)
  if (prof.source === "erpnext" && erpConfigured()) {
    const erp = (await getErpUsers([email]).catch(() => null))?.get(email);
    after(() => runErpSync("login", email));
    if (erp && !erp.enabled) return NextResponse.json({ ok: false, inactive: true }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    name: prof.full_name,
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
}
