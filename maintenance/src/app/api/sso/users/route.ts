import { NextResponse } from "next/server";
import { secretOk } from "@/lib/sso";
import { createAdminClient } from "@/lib/supabase/admin";

// Used by Staff approvals on the dashboard site (server to server, secret header): list the Maintenance users,
// set a new password, switch an account on or off.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  if (!secretOk(req)) return NextResponse.json({ ok: false }, { status: 401 });
  const { data, error } = await createAdminClient()
    .from("profiles")
    .select("id, full_name, email, role, active, source, is_training, created_at")
    .order("full_name");
  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  return NextResponse.json({ ok: true, users: data ?? [] });
}

export async function POST(req: Request) {
  if (!secretOk(req)) return NextResponse.json({ ok: false }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { action?: string; id?: string; password?: string; active?: boolean };
  if (!b.id || !UUID.test(b.id)) return NextResponse.json({ ok: false, error: "Unknown user." }, { status: 400 });
  const admin = createAdminClient();
  if (b.action === "setpassword") {
    const pw = String(b.password ?? "");
    if (pw.length < 8 || pw.length > 100) return NextResponse.json({ ok: false, error: "Password must be at least 8 characters." }, { status: 400 });
    const { error } = await admin.auth.admin.updateUserById(b.id, { password: pw });
    if (error) return NextResponse.json({ ok: false, error: "Could not change the password." }, { status: 500 });
    await admin.from("profiles").update({ must_change_password: true }).eq("id", b.id);
    return NextResponse.json({ ok: true });
  }
  if (b.action === "setactive" && typeof b.active === "boolean") {
    // a manual change is the admin's decision: the ERPNext sync will not undo it; a ban also ends existing sessions
    await admin.from("profiles").update({ active: b.active, deactivated_by_sync: false }).eq("id", b.id);
    await admin.auth.admin.updateUserById(b.id, { ban_duration: b.active ? "none" : "876000h" });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
}
