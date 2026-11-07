import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { secretOk } from "@/lib/sso";
import { createAdminClient } from "@/lib/supabase/admin";

// Used when a super admin of the dashboard site (already signed in there) opens Maintenance: finds the Maintenance
// Super Admin account with the same name and returns a session for it, so no second sign-in is needed.
// (Server to server, secret header. The authenticator step of Maintenance Super Admins still applies afterwards.)
export async function POST(req: Request) {
  if (!secretOk(req)) return NextResponse.json({ ok: false }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { name?: string };
  const name = String(b.name ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (name.length < 2) return NextResponse.json({ ok: false }, { status: 400 });

  const admin = createAdminClient();
  const { data: rows } = await admin.from("profiles").select("id, email, full_name").eq("role", "admin").eq("active", true);
  const hit = (rows ?? []).filter((r) => String(r.full_name).replace(/\s+/g, " ").trim().toLowerCase() === name);
  if (hit.length !== 1) return NextResponse.json({ ok: false, found: hit.length }, { status: 404 });

  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: hit[0].email });
  const tokenHash = link?.properties?.hashed_token;
  if (error || !tokenHash) return NextResponse.json({ ok: false }, { status: 500 });
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error: e2 } = await anon.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (e2 || !data.session) return NextResponse.json({ ok: false }, { status: 500 });
  return NextResponse.json({ ok: true, access_token: data.session.access_token, refresh_token: data.session.refresh_token });
}
