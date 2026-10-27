// Click-to-chat WhatsApp messages the store sends from its own WhatsApp (no WhatsApp Business API needed yet).
// The message is always in Arabic with an English line, matching the customer emails.
export type WaKind = "received" | "quote" | "ready" | "reminder" | "collected" | "update";

export function waKind(status: string): WaKind {
  if (status === "awaiting_customer_approval") return "quote";
  if (status === "ready_for_pickup") return "ready";
  if (status === "uncollected") return "reminder";
  if (status === "collected" || status === "closed") return "collected";
  if (["received_at_branch", "awaiting_dispatch"].includes(status)) return "received";
  return "update";
}

export function waMessage(kind: WaKind, v: { name: string; ticketNo: string; item: string; store: string; link: string; quote?: string }) {
  const hi = `عزيزنا العميل ${v.name.split(/\s+/)[0] || ""}،`;
  const ref = `رقم طلب الصيانة: ${v.ticketNo}
المنتج: ${v.item}`;
  const body: Record<WaKind, string> = {
    received: `نشكركم على ثقتكم في باندورا. نود إفادتكم بأنه تم استلام منتجكم في فرع ${v.store}، وسيتم إرساله إلى مركز الصيانة لإجراء الفحص اللازم.`,
    update: `نود إطلاعكم على آخر مستجدات طلب الصيانة الخاص بكم، ويمكنكم متابعة حالته في أي وقت من خلال الرابط أدناه.`,
    quote: `تم الانتهاء من فحص منتجكم${v.quote ? `، وتبلغ تكلفة الإصلاح ${v.quote} جنيهاً مصرياً شاملة ضريبة القيمة المضافة` : ""}. نرجو التكرم بالموافقة على عرض السعر أو رفضه من خلال الرابط أدناه حتى نتمكن من استكمال الإجراءات.`,
    ready: `يسعدنا إبلاغكم بأن منتجكم أصبح جاهزاً للاستلام من فرع ${v.store}. يرجى إحضار إيصال الاستلام عند الحضور.`,
    reminder: `نود تذكيركم بأن منتجكم لا يزال بانتظاركم في فرع ${v.store}. يرجى إحضار إيصال الاستلام عند الحضور.`,
    collected: `نشكركم على استلام منتجكم، ونتطلع دائماً إلى خدمتكم.`,
  };
  return `${hi}

${body[kind]}

${ref}
متابعة الطلب: ${v.link}

مع خالص التحية،
فريق خدمة العملاء – باندورا ${v.store}`;
}

// Egyptian 01xxxxxxxxx → 201xxxxxxxxx for wa.me
export function waNumber(mobile: string) {
  const d = mobile.replace(/\D/g, "");
  return /^01\d{9}$/.test(d) ? `2${d}` : d;
}
