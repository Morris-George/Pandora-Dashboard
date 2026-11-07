import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { BASE_PATH } from "@/lib/base";
import { readTicket, SSO_COOKIE } from "@/lib/sso";

// Landing point after signing in on the main login page: turns the short-lived signed cookie into the Maintenance session.
export async function GET(req: NextRequest) {
  const ticket = readTicket(req.cookies.get(SSO_COOKIE)?.value);
  // relative Location: keeps the visitor on the host they came in on (pandora-eg.online)
  const res = new NextResponse(null, { status: 307, headers: { Location: ticket ? BASE_PATH : "/login.html" } });
  res.cookies.set(SSO_COOKIE, "", { path: "/", maxAge: 0 });
  if (!ticket) return res;
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => list.forEach(({ name, value, options }) => res.cookies.set(name, value, options)),
    },
  });
  const { error } = await supabase.auth.setSession(ticket);
  if (error) res.headers.set("Location", "/login.html");
  return res;
}
