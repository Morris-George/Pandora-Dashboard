import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { erpConfigured, fetchErpFile } from "@/lib/erpnext";

// Proxies ERPNext item images to signed-in users without exposing ERP credentials.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse(null, { status: 401 });
  if (!erpConfigured()) return new NextResponse(null, { status: 404 });

  const path = req.nextUrl.searchParams.get("path") ?? "";
  const file = await fetchErpFile(path);
  const type = file?.headers.get("content-type") ?? "";
  if (!file || !type.startsWith("image/")) return new NextResponse(null, { status: 404 });

  return new NextResponse(file.body, {
    headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600" },
  });
}
