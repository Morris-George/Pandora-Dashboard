import { NextResponse } from "next/server";
import { getI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildReport, levelFor, toXlsx } from "@/lib/reports";

// Excel export — only for roles the admin granted "View + Export"
export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if ((await levelFor(supabase, key)) !== "export") return new NextResponse("Forbidden", { status: 403 });

  const { t: d, locale } = await getI18n();
  const rep = await buildReport(key, supabase, d, locale);
  if (!rep) return new NextResponse("Not found", { status: 404 });

  // Users can't write the audit log directly; record the export server-side
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  await createAdminClient().from("audit_log").insert({ user_id: user.id, role: me?.role, entity: "reports", entity_id: key, action: "export", new_value: { rows: rep.rows.length } });
  const stamp = new Date().toISOString().slice(0, 10);
  const file = await toXlsx(rep, d.admin.repNames[key] ?? key, locale);
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="pandora-${key}-${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
