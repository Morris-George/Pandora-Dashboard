import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { ReceiptView } from "@/app/receipt/[id]/receipt-view";

export const metadata = { title: "Pandora — Receipt", robots: { index: false } };

// Customer's copy of the intake memo, linked from the WhatsApp message (no sign-in: the tracking token is the key).
// "Save / print" on the page lets the customer keep it as a PDF.
export default async function MemoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{32}$/.test(token)) notFound();
  const db = createAdminClient();
  const { data: tk } = await db.from("tickets").select("id").eq("tracking_token", token).neq("status", "draft").maybeSingle();
  if (!tk) notFound();
  return ReceiptView({ id: tk.id, delivery: false, supabase: db, print: false });
}
