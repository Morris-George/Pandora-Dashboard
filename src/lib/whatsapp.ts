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
  const hi = `أهلاً ${v.name.split(/\s+/)[0] || ""}،`;
  const ref = `رقم التيكيت: ${v.ticketNo}\nالقطعة: ${v.item}`;
  const body: Record<WaKind, string> = {
    received: `استلمنا قطعتك في فرع ${v.store} وهنبعتها للصيانة.`,
    update: `دي آخر حالة لقطعتك عندنا في الصيانة، تقدر تتابعها من الرابط.`,
    quote: `الفني خلص فحص قطعتك. تكلفة الإصلاح${v.quote ? ` ${v.quote} جنيه (شامل الضريبة)` : ""}. من فضلك وافق أو ارفض من الرابط عشان نكمل.`,
    ready: `قطعتك جاهزة للاستلام من فرع ${v.store}. هات معاك إيصال الاستلام.`,
    reminder: `تذكير: قطعتك لسه مستنياك في فرع ${v.store}. هات معاك إيصال الاستلام.`,
    collected: `شكراً إنك استلمت قطعتك. يسعدنا نخدمك دايماً.`,
  };
  return `${hi}\n${body[kind]}\n\n${ref}\nتابع التيكيت: ${v.link}\n\nPandora · ${v.store}`;
}

// Egyptian 01xxxxxxxxx → 201xxxxxxxxx for wa.me
export function waNumber(mobile: string) {
  const d = mobile.replace(/\D/g, "");
  return /^01\d{9}$/.test(d) ? `2${d}` : d;
}
