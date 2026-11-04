import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Short tracking link for WhatsApp: /t/<first 10 characters of the tracking token> → /track/<full token>
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const home = new URL("/track", req.url);
  if (!/^[0-9a-f]{10}$/.test(code)) return NextResponse.redirect(home);
  const { data } = await createAdminClient().from("tickets").select("tracking_token").like("tracking_token", `${code}%`).limit(2);
  if (data?.length !== 1) return NextResponse.redirect(home);
  return NextResponse.redirect(new URL(`/track/${data[0].tracking_token}`, req.url));
}
