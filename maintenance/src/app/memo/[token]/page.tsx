import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { ReceiptView } from "@/app/receipt/[id]/receipt-view";
import { getI18n } from "@/lib/i18n";
import { ConfirmBox } from "./confirm-box";

export const metadata = { title: "Pandora — Receipt", robots: { index: false } };

// Customer's copy of the receipt, linked from WhatsApp (no sign-in: the tracking token is the key).
// ?kind=delivery = the collection receipt. The customer confirms once with the button; the PDF button downloads it.
export default async function MemoPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ kind?: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{32}$/.test(token)) notFound();
  const delivery = (await searchParams).kind === "delivery";
  const db = createAdminClient();
  const { data: tk } = await db.from("tickets").select("id, status, customer_confirmed_intake_at, customer_confirmed_pickup_at").eq("tracking_token", token).neq("status", "draft").maybeSingle();
  if (!tk) notFound();
  const { t, locale } = await getI18n();
  const r = t.receipt;
  return (
    <>
      <ConfirmBox token={token} kind={delivery ? "pickup" : "intake"}
        at={delivery ? tk.customer_confirmed_pickup_at : tk.customer_confirmed_intake_at}
        canConfirm={!delivery || ["collected", "closed"].includes(tk.status)}
        l={{ confirm: delivery ? r.confirmPickup : r.confirmIntake, confirmed: delivery ? r.confirmedPickup : r.confirmedIntake, failed: r.confirmFailed, pdf: r.downloadPdf, locale }} />
      {await ReceiptView({ id: tk.id, delivery, supabase: db, print: false })}
    </>
  );
}
