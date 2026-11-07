import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BASE_PATH } from "@/lib/base";

const go = (path: string) => new NextResponse(null, { status: 307, headers: { Location: BASE_PATH + path } }); // relative: keeps the visitor on their host

const MAX_MISSES = 20; // wrong codes per IP per hour before the link stops answering

// Short tracking link for WhatsApp: /t/<first 10 characters of the tracking token> → /track/<full token>
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const db = createAdminClient();
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const key = `short:${ip}`;
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db.from("public_attempts").select("id", { count: "exact", head: true }).eq("key", key).eq("ok", false).gt("at", since);
  if ((count ?? 0) >= MAX_MISSES) return new NextResponse("Too many attempts. Try again later.", { status: 429 });

  const miss = async () => { await db.from("public_attempts").insert({ key, ok: false }); return go("/track"); };
  if (!/^[0-9a-f]{10}$/.test(code)) return miss();
  const { data } = await db.from("tickets").select("tracking_token").like("tracking_token", `${code}%`).limit(2);
  if (data?.length !== 1) return miss();
  return go(`/track/${data[0].tracking_token}`);
}
