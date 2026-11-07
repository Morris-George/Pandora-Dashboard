import { NextResponse } from "next/server";
import { getI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { toXlsx } from "@/lib/reports";
import { listTickets, ticketCells, ticketColumns } from "@/lib/ticket-list";

// Ticket Tracking → Excel: the tickets this person can see (RLS), with the same filters as the screen
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const sp = new URL(req.url).searchParams;
  const clean = (s: string | null) => (s ?? "").trim().replace(/[%,()]/g, "");
  const rows = await listTickets(supabase, { term: clean(sp.get("q")), name: clean(sp.get("name")), mobile: (sp.get("mobile") ?? "").replace(/\D/g, "").slice(-9) }, 5000);

  const { t: d, locale } = await getI18n();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  await createAdminClient().from("audit_log").insert({ user_id: user.id, role: me?.role, entity: "tickets", entity_id: "tracking", action: "export", new_value: { rows: rows.length } });
  const file = await toXlsx({ summary: [], columns: ticketColumns(d), rows: rows.map((r) => ticketCells(r, d, locale)) }, d.tracking.title, locale);
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="pandora-tickets-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
