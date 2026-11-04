import "server-only";
import nodemailer from "nodemailer";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailSubject, renderEmail, type EmailKind, type EmailTemplates } from "@/lib/email-templates";

// Customer emails (SMS later). Status changes queue rows in email_outbox (DB trigger);
// this sends the queue through our mail server (SMTP). Settings come from Admin → Email
// (mail_settings, server-only); the SMTP_* environment variables are the fallback.

export type MailConfig = { host: string; port: number; user: string; pass: string; from: string; paused: boolean };

export async function mailConfig(): Promise<MailConfig | null> {
  const { data: m } = await createAdminClient().from("mail_settings").select("*").maybeSingle();
  const host = m?.host || process.env.SMTP_HOST, user = m?.username || process.env.SMTP_USER, pass = m?.password || process.env.SMTP_PASS;
  const fromEmail = m?.from_email || null;
  const from = fromEmail ? `${m?.from_name || "Pandora Maintenance"} <${fromEmail}>` : process.env.EMAIL_FROM;
  if (!host || !user || !pass || !from) return null;
  return { host, port: Number(m?.port || process.env.SMTP_PORT || 587), user, pass, from, paused: m ? m.paused : process.env.EMAIL_PAUSED === "1" };
}

const transport = (c: MailConfig) => nodemailer.createTransport({ host: c.host, port: c.port, secure: c.port === 465, auth: { user: c.user, pass: c.pass } });

const SITE = process.env.SITE_URL ?? "https://pandora-maintenance.vercel.app";

type Kind = EmailKind;

async function templates(): Promise<EmailTemplates> {
  const { data } = await createAdminClient().from("app_settings").select("value").eq("key", "email_templates").maybeSingle();
  return (data?.value ?? {}) as EmailTemplates;
}

// Super Admin check of the mail server settings: one email to any address (works while paused)
export async function sendTestEmail(to: string): Promise<string | null> {
  const c = await mailConfig();
  if (!c) return "not configured";
  return transport(c).sendMail({
    from: c.from, to, subject: "Pandora Maintenance — test email",
    html: renderEmail(await templates(), "received", "Test", "TEST-0000", "Test item", SITE),
  }).then(() => null, (e: unknown) => String(e).slice(0, 300));
}

// Sends up to `limit` queued emails. Safe to call often (e.g. in after()).
export async function flushEmails(limit = 20): Promise<{ sent: number; failed: number }> {
  const out = { sent: 0, failed: 0 };
  const db = createAdminClient();
  const c = await mailConfig();
  // Paused (pilot): drop queued notices so old ones are not sent later when email is switched on
  if (!c || c.paused) {
    await db.from("email_outbox").update({ status: "failed", last_error: "email paused" }).eq("status", "pending");
    return out;
  }
  const smtp = transport(c);
  const tpl = await templates();
  const { data: rows } = await db.from("email_outbox")
    .select("id, kind, to_email, attempts, tickets(ticket_no, item_name, tracking_token, customers(full_name))")
    .eq("status", "pending").lt("attempts", 5).order("created_at").limit(limit);
  for (const r of rows ?? []) {
    const t = r.tickets as unknown as { ticket_no: string; item_name: string; tracking_token: string; customers: { full_name: string } | null } | null;
    if (!t) continue;
    const kind = r.kind as Kind;
    const err = await smtp.sendMail({
      from: c.from, to: r.to_email, headers: { "Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "All" }, subject: emailSubject(tpl, kind, t.ticket_no),
      html: renderEmail(tpl, kind, t.customers?.full_name ?? "", t.ticket_no, t.item_name, `${SITE}/track/${t.tracking_token}`),
    }).then(() => null, (e: unknown) => String(e).slice(0, 300));
    if (!err) {
      await db.from("email_outbox").update({ status: "sent", sent_at: new Date().toISOString(), attempts: r.attempts + 1 }).eq("id", r.id);
      out.sent++;
    } else {
      await db.from("email_outbox").update({ attempts: r.attempts + 1, last_error: err, status: r.attempts + 1 >= 5 ? "failed" : "pending" }).eq("id", r.id);
      out.failed++;
    }
  }
  return out;
}

// Internal staff alert (works even while customer emails are paused)
export async function sendStaffEmail(to: string[], subject: string, html: string): Promise<string | null> {
  const c = await mailConfig();
  if (!c || !to.length) return "not configured";
  return transport(c).sendMail({ from: c.from, to, subject, html }).then(() => null, (e: unknown) => String(e).slice(0, 300));
}
