import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ReceiptView } from "./receipt-view";

export const metadata = { title: "Pandora Maintenance" };

// Customer receipts for 80 mm thermal printers (open the print dialog by themselves):
// intake receipt, or ?kind=delivery at pickup (what was done, invoice, who collected)
export default async function ReceiptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ kind?: string }> }) {
  await requireSession();
  const { id } = await params;
  return ReceiptView({ id, delivery: (await searchParams).kind === "delivery", supabase: await createClient(), print: true });
}
