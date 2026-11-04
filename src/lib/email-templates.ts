// Customer email look and wording, edited in Admin → Email design (app_settings 'email_templates').
// Shared by the sender (server) and the live preview in Admin (client).
export type EmailKind = "received" | "quote" | "ready" | "collected";
export const EMAIL_KINDS: EmailKind[] = ["received", "quote", "ready", "collected"];

export type EmailDesign = {
  brand: string; headerColor: string; headerText: string; buttonColor: string; buttonText: string;
  background: string; button: string; footerAr: string; footerEn: string; greeting: string;
};
export type EmailCopy = { subject: string; ar: string; en: string };
export type EmailTemplates = { design?: Partial<EmailDesign>; kinds?: Partial<Record<EmailKind, Partial<EmailCopy>>> };

export const EMAIL_DESIGN: EmailDesign = {
  brand: "PANDORA", headerColor: "#FF93A0", headerText: "#2A1018", buttonColor: "#FF93A0", buttonText: "#2A1018",
  background: "#f6f1f2", button: "تابع التيكيت · Track ticket", greeting: "أهلاً {name}،",
  footerAr: "دي رسالة تلقائية، من فضلك ماتردش عليها. للاستفسار كلم الفرع من صفحة التتبع.",
  footerEn: "This is an automated message — please do not reply. For questions, contact your store from the tracking page.",
};

// Placeholders: {name} {ticket} {item}
export const EMAIL_COPY: Record<EmailKind, EmailCopy> = {
  received: { subject: "استلمنا قطعتك للصيانة — {ticket}", ar: "استلمنا قطعتك في الفرع وهنبعتها للصيانة. تقدر تتابع حالتها من الرابط.", en: "We received your piece at the store and will send it for repair. Follow its status from the link." },
  quote: { subject: "عرض سعر الصيانة جاهز — {ticket}", ar: "عرض سعر الصيانة جاهز. افتح الرابط عشان توافق أو ترفض.", en: "Your repair quote is ready. Open the link to approve or reject it." },
  ready: { subject: "قطعتك جاهزة للاستلام — {ticket}", ar: "قطعتك جاهزة للاستلام من الفرع. هات معاك رقم التيكيت.", en: "Your piece is ready for pickup at the store. Please bring your ticket number." },
  collected: { subject: "شكراً لاستلام قطعتك — {ticket}", ar: "تم تسليم قطعتك. شكراً لاختيارك باندورا.", en: "Your piece has been collected. Thank you for choosing Pandora." },
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const color = (v: string | undefined, d: string) => (v && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : d);

export function resolve(tpl: EmailTemplates, kind: EmailKind) {
  const d = { ...EMAIL_DESIGN, ...Object.fromEntries(Object.entries(tpl.design ?? {}).filter(([, v]) => typeof v === "string" && v.trim())) } as EmailDesign;
  const k = tpl.kinds?.[kind] ?? {};
  const c: EmailCopy = { subject: k.subject?.trim() || EMAIL_COPY[kind].subject, ar: k.ar?.trim() || EMAIL_COPY[kind].ar, en: k.en?.trim() ?? EMAIL_COPY[kind].en };
  return { d, c };
}

const fill = (s: string, v: Record<string, string>) => s.replace(/\{(name|ticket|item)\}/g, (_, k: string) => v[k]);

export function emailSubject(tpl: EmailTemplates, kind: EmailKind, ticketNo: string) {
  return fill(resolve(tpl, kind).c.subject, { name: "", ticket: ticketNo, item: "" });
}

export function renderEmail(tpl: EmailTemplates, kind: EmailKind, name: string, ticketNo: string, item: string, link: string) {
  const { d, c } = resolve(tpl, kind);
  const v = { name: esc(name), ticket: esc(ticketNo), item: esc(item) };
  const txt = (s: string) => fill(esc(s), v).replace(/\n/g, "<br>");
  return `<!doctype html><html><body style="margin:0;background:${color(d.background, EMAIL_DESIGN.background)};font-family:Arial,sans-serif;color:#2A1018">
<div style="max-width:520px;margin:24px auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #eadfe1">
<div style="background:${color(d.headerColor, EMAIL_DESIGN.headerColor)};color:${color(d.headerText, EMAIL_DESIGN.headerText)};padding:18px 24px;font-weight:bold;font-size:18px;letter-spacing:2px">${esc(d.brand)}</div>
<div dir="rtl" style="padding:24px;text-align:right;line-height:1.7">
<p>${txt(d.greeting)}</p><p>${txt(c.ar)}</p>
<p style="margin:0">رقم التيكيت: <b dir="ltr">${v.ticket}</b><br>القطعة: ${v.item}</p></div>
${c.en ? `<div dir="ltr" style="padding:0 24px 8px;color:#6b5a5e;font-size:14px;line-height:1.6">${txt(c.en)}</div>` : ""}
<div style="padding:16px 24px 28px;text-align:center"><a href="${esc(link)}" style="display:inline-block;background:${color(d.buttonColor, EMAIL_DESIGN.buttonColor)};color:${color(d.buttonText, EMAIL_DESIGN.buttonText)};text-decoration:none;font-weight:bold;padding:12px 28px;border-radius:10px">${esc(d.button)}</a></div>
<div style="border-top:1px solid #eadfe1;padding:14px 24px;color:#8a7a7e;font-size:12px;line-height:1.6;text-align:center">
<div dir="rtl">${txt(d.footerAr)}</div>
<div dir="ltr">${txt(d.footerEn)}</div></div>
</div></body></html>`;
}
