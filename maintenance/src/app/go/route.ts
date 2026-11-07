import { NextResponse, type NextRequest } from "next/server";
import { BASE_PATH } from "@/lib/base";

// Header search: sends the term to Ticket Tracking as a mobile number, a ticket / SKU, or a customer name
export function GET(req: NextRequest) {
  const s = (req.nextUrl.searchParams.get("s") ?? "").trim().slice(0, 80);
  const digits = s.replace(/[\s+()-]/g, "");
  const url = new URL("/tracking", "http://local.invalid");
  if (/^\d{9,15}$/.test(digits)) url.searchParams.set("mobile", digits);
  else if (/\d/.test(s)) url.searchParams.set("q", s);
  else if (s) url.searchParams.set("name", s);
  // relative Location: keeps the visitor on the host they came in on
  return new NextResponse(null, { status: 307, headers: { Location: BASE_PATH + url.pathname + url.search } });
}
