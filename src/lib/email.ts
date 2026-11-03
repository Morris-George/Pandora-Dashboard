import "server-only";
import nodemailer from "nodemailer";
import { createAdminClient } from "@/lib/supabase/admin";

// Customer emails (SMS later). Status changes queue rows in email_outbox (DB trigger);
// this sends the queue through our mail server (SMTP). Without SMTP settings the rows simply wait.

export const emailConfigured = () => !!process.env.SMTP_HOST && !!process.env.SMTP_USER && !!process.env.SMTP_PASS && !!process.env.EMAIL_FROM;

const SITE = process.env.SITE_URL ?? "https://pandora-maintenance.vercel.app";

type Kind = "received" | "quote" | "ready" | "collected";
const COPY: Record<Kind, { subject: (no: string) => string; ar: string; en: string }> = {
  received: { subject: (no) => `استلمنا قطعتك للصيانة — ${no}`, ar: "استلمنا قطعتك في الفرع وهنبعتها للصيانة. تقدر تتابع حالتها من الرابط.", en: "We received your piece at the store and will send it for repair. Follow its status from the link." },
  quote: { subject: (no) => `عرض سعر الصيانة جاهز — ${no}`, ar: "عرض سعر الصيانة جاهز. افتح الرابط عشان توافق أو ترفض.", en: "Your repair quote is ready. Open the link to approve or reject it." },
  ready: { subject: (no) => `قطعتك جاهزة للاستلام — ${no}`, ar: "قطعتك جاهزة للاستلام من الفرع. هات معاك رقم التيكيت.", en: "Your piece is ready for pickup at the store. Please bring your ticket number." },
  collected: { subject: (no) => `شكراً لاستلام قطعتك — ${no}`, ar: "تم تسليم قطعتك. شكراً لاختيارك باندورا.", en: "Your piece has been collected. Thank you for choosing Pandora." },
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function render(kind: Kind, name: string, ticketNo: string, item: string, link: string) {
  const c = COPY[kind];
  return `<!doctype html><html><body style="margin:0;background:#f6f1f2;font-family:Arial,sans-serif;color:#2A1018">
<div style="max-width:520px;margin:24px auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #eadfe1">
<div style="background:#FF93A0;padding:18px 24px;font-weight:bold;font-size:18px;letter-spacing:2px">PANDORA</div>
<div dir="rtl" style="padding:24px;text-align:right;line-height:1.7">
<p>أهلاً ${esc(name)}،</p><p>${c.ar}</p>
<p style="margin:0">رقم التيكيت: <b dir="ltr">${esc(ticketNo)}</b><br>القطعة: ${esc(item)}</p></div>
<div dir="ltr" style="padding:0 24px 8px;color:#6b5a5e;font-size:14px;line-height:1.6">${c.en}</div>
<div style="padding:16px 24px 28px;text-align:center"><a href="${link}" style="display:inline-block;background:#FF93A0;color:#2A1018;text-decoration:none;font-weight:bold;padding:12px 28px;border-radius:10px">تابع التيكيت · Track ticket</a></div>
<div style="border-top:1px solid #eadfe1;padding:14px 24px;color:#8a7a7e;font-size:12px;line-height:1.6;text-align:center">
<div dir="rtl">دي رسالة تلقائية، من فضلك ماتردش عليها. للاستفسار كلم الفرع من صفحة التتبع.</div>
<div dir="ltr">This is an automated message — please do not reply. For questions, contact your store from the tracking page.</div></div>
</div></body></html>`;
}

// Super Admin check of the mail server settings: one plain email to the given address
export async function sendTestEmail(to: string): Promise<string | null> {
  if (!emailConfigured()) return "not configured";
  const port = Number(process.env.SMTP_PORT ?? 587);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST, port, secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  }).sendMail({
    from: process.env.EMAIL_FROM, to, subject: "Pandora Maintenance — test email",
    html: render("received", "Test", "TEST-0000", "Test item", SITE),
  }).then(() => null, (e: unknown) => String(e).slice(0, 300));
}

// Sends up to `limit` queued emails. Safe to call often (e.g. in after()).
export async function flushEmails(limit = 20): Promise<{ sent: number; failed: number }> {
  const out = { sent: 0, failed: 0 };
  const db = createAdminClient();
  // Paused (pilot): drop queued notices so old ones are not sent later when email is switched on
  if (process.env.EMAIL_PAUSED === "1") {
    await db.from("email_outbox").update({ status: "failed", last_error: "email paused" }).eq("status", "pending");
    return out;
  }
  if (!emailConfigured()) return out;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const smtp = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port, secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const { data: rows } = await db.from("email_outbox")
    .select("id, kind, to_email, attempts, tickets(ticket_no, item_name, tracking_token, customers(full_name))")
    .eq("status", "pending").lt("attempts", 5).order("created_at").limit(limit);
  for (const r of rows ?? []) {
    const t = r.tickets as unknown as { ticket_no: string; item_name: string; tracking_token: string; customers: { full_name: string } | null } | null;
    if (!t) continue;
    const kind = r.kind as Kind;
    const err = await smtp.sendMail({
      from: process.env.EMAIL_FROM, to: r.to_email, headers: { "Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "All" }, subject: COPY[kind].subject(t.ticket_no),
      html: render(kind, t.customers?.full_name ?? "", t.ticket_no, t.item_name, `${SITE}/track/${t.tracking_token}`),
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
