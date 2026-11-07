import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

// Single sign-on with the Pandora Dashboards main login page (pandora-eg.online).
// The dashboard site signs people in here through the secret-protected /api/sso routes and hands the session over
// in a short-lived signed cookie that /sso turns into the normal Maintenance session.
export const SSO_COOKIE = "mnt_sso";

const secret = () => process.env.MAINTENANCE_SSO_SECRET ?? "";

export function secretOk(req: Request): boolean {
  const s = secret();
  const h = req.headers.get("x-sso-secret") ?? "";
  if (s.length < 32 || h.length !== s.length) return false;
  return timingSafeEqual(Buffer.from(h), Buffer.from(s));
}

export function readTicket(value: string | undefined): { access_token: string; refresh_token: string } | null {
  const s = secret();
  if (!value || s.length < 32) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  const want = createHmac("sha256", s).update(payload).digest("hex");
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const t = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { a?: string; r?: string; e?: number };
    if (!t.a || !t.r || !t.e || t.e < Math.floor(Date.now() / 1000)) return null;
    return { access_token: t.a, refresh_token: t.r };
  } catch {
    return null;
  }
}
