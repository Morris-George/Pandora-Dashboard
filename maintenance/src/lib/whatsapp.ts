// Click-to-chat WhatsApp messages the store sends from its own WhatsApp (no WhatsApp Business API needed yet).
// Each message is a template the Super Admin can edit in Admin → WhatsApp messages.
export type WaKind = "received" | "quote" | "ready" | "reminder" | "collected" | "update";
export const WA_KINDS: WaKind[] = ["received", "quote", "ready", "reminder", "collected", "update"];
export type WaTemplates = Partial<Record<WaKind, string>>;

export function waKind(status: string): WaKind {
  if (status === "awaiting_customer_approval") return "quote";
  if (status === "ready_for_pickup") return "ready";
  if (status === "uncollected") return "reminder";
  if (status === "collected" || status === "closed") return "collected";
  if (["received_at_branch", "awaiting_dispatch"].includes(status)) return "received";
  return "update";
}

// Placeholders: {name} {ticket} {item} {store} {link} {quote} {memo}
const frame = (body: string) => `عزيزنا العميل {name}،

${body}

رقم طلب الصيانة: {ticket}
المنتج: {item}
متابعة الطلب: {link}

مع خالص التحية،
فريق خدمة العملاء – باندورا {store}`;

export const WA_DEFAULTS: Record<WaKind, string> = {
  received: frame("نشكركم على ثقتكم في باندورا. نود إفادتكم بأنه تم استلام منتجكم في فرع {store}، وسيتم إرساله إلى مركز الصيانة لإجراء الفحص اللازم.\nإيصال الاستلام (PDF): {memo}"),
  update: frame("نود إطلاعكم على آخر مستجدات طلب الصيانة الخاص بكم، ويمكنكم متابعة حالته في أي وقت من خلال الرابط أدناه."),
  quote: frame("تم الانتهاء من فحص منتجكم، وتبلغ تكلفة الإصلاح {quote} جنيهاً مصرياً شاملة ضريبة القيمة المضافة. نرجو التكرم بالموافقة على عرض السعر أو رفضه من خلال الرابط أدناه حتى نتمكن من استكمال الإجراءات."),
  ready: frame("يسعدنا إبلاغكم بأن منتجكم أصبح جاهزاً للاستلام من فرع {store}. يرجى إحضار إيصال الاستلام عند الحضور."),
  reminder: frame("نود تذكيركم بأن منتجكم لا يزال بانتظاركم في فرع {store}. يرجى إحضار إيصال الاستلام عند الحضور."),
  collected: frame("نشكركم على استلام منتجكم، ونتطلع دائماً إلى خدمتكم."),
};

export function waMessage(kind: WaKind, v: { name: string; ticketNo: string; item: string; store: string; link: string; quote?: string; memo?: string }, templates: WaTemplates = {}) {
  let tpl = templates[kind]?.trim() || WA_DEFAULTS[kind];
  // A saved "received" text without the memo placeholder still gets the memo link at the end
  if (kind === "received" && v.memo && !tpl.includes("{memo}")) tpl += "\n\nإيصال الاستلام (PDF): {memo}";
  const vals: Record<string, string> = {
    name: v.name.split(/\s+/)[0] || "", ticket: v.ticketNo, item: v.item, store: v.store, link: v.link, quote: v.quote ?? "—", memo: v.memo ?? v.link,
  };
  return tpl.replace(/\{(name|ticket|item|store|link|quote|memo)\}/g, (_, k: string) => vals[k]);
}

// Egyptian 01xxxxxxxxx → 201xxxxxxxxx for wa.me
export function waNumber(mobile: string) {
  const d = mobile.replace(/\D/g, "");
  return /^01\d{9}$/.test(d) ? `2${d}` : d;
}

export function waLink(mobile: string, text: string) {
  return `https://wa.me/${waNumber(mobile)}?text=${encodeURIComponent(text)}`;
}
