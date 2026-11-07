import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { siteOrigin } from "@/lib/base";

// Refreshes the session on every request and keeps signed-out users on /login.
// Customer pages under /track are public (tokenised link + OTP).
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // getClaims() refreshes an expiring session and verifies the JWT locally (no Auth round trip)
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims?.sub;
  const path = request.nextUrl.pathname;
  // Cron calls carry their own secret (checked in the route)
  const isPublic = path.startsWith("/login") || path === "/sso" || path.startsWith("/api/sso/") || path === "/track" || path.startsWith("/track/") || path.startsWith("/t/") || path === "/api/cron/erp-sync";
  if (!user && !isPublic) {
    // signed out: the main login page (absolute URL: middleware cannot send a relative Location)
    return NextResponse.redirect(siteOrigin(request.headers) + "/login.html");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|webp)$).*)"],
};
