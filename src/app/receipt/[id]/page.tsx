import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { requireSession } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { AutoPrint } from "./auto-print";

export const metadata = { title: "Pandora Maintenance" };

// Customer receipts for 80 mm thermal printers (open the print dialog by themselves):
// intake receipt, or ?kind=delivery at pickup (what was done, invoice, who collected)
export default async function ReceiptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ kind?: string }> }) {
  await requireSession();
  const { t: d, locale } = await getI18n();
  const t = d.receipt;
  const { id } = await params;
  const delivery = (await searchParams).kind === "delivery";
  const supabase = await createClient();
  const { data: tk } = await supabase.from("tickets")
    .select("id, ticket_no, tracking_token, status, item_name, item_code, fault_category, accessories, agreed_amount, created_at, customer_id, warranty_final, erp_repair_invoice, branches(name)")
    .eq("id", id).maybeSingle();
  if (!tk) notFound();
  const { data: c } = await supabase.from("customers").select("full_name, mobile").eq("id", tk.customer_id).maybeSingle();
  const [{ data: diag }, { data: quote }, { data: done }] = delivery ? await Promise.all([
    supabase.from("diagnoses").select("fault_found").eq("ticket_id", tk.id).maybeSingle(),
    supabase.from("quotations").select("total").eq("ticket_id", tk.id).eq("status", "approved").order("responded_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("status_history").select("at, reason").eq("ticket_id", tk.id).eq("to_status", "collected").order("at", { ascending: false }).limit(1).maybeSingle(),
  ]) : [{ data: null }, { data: null }, { data: null }];

  const url = `${process.env.APP_BASE_URL ?? ""}/track/${tk.tracking_token}`;
  const qr = await QRCode.toString(url, { type: "svg", margin: 0, width: 150 });
  const when = new Date(tk.created_at).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "short", timeStyle: "short" });
  const mobile = c?.mobile ? `${c.mobile.slice(0, 3)}•••••${c.mobile.slice(-3)}` : "";
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="flex justify-between gap-2"><span>{k}</span><b className="text-end">{v}</b></div>
  );

  return (
    <main className="receipt mx-auto bg-white text-black">
      <style>{`
        @page { size: 80mm auto; margin: 3mm; }
        body { background: #fff !important; }
        .receipt { width: 72mm; font: 12px/1.45 system-ui, sans-serif; padding: 2mm 0; }
        .receipt hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
        @media screen { .receipt { margin-top: 16px; box-shadow: 0 0 0 1px #ddd; padding: 3mm; } }
      `}</style>
      <AutoPrint label={t.print} />
      <div className="text-center">
        <div className="text-lg font-extrabold tracking-[0.3em]">PANDORA</div>
        <div>{delivery ? t.deliveryTitle : t.title}</div>
        <div className="text-[11px]">{(tk.branches as unknown as { name: string } | null)?.name} · {when}</div>
      </div>
      <hr />
      <div className="text-center text-xl font-extrabold" dir="ltr">{tk.ticket_no}</div>
      <hr />
      <Row k={t.customer} v={c?.full_name ?? "—"} />
      {mobile && <Row k={t.mobile} v={<span dir="ltr">{mobile}</span>} />}
      <Row k={t.item} v={tk.item_name} />
      {tk.item_code && <Row k={t.code} v={<span dir="ltr">{tk.item_code}</span>} />}
      <Row k={t.fault} v={tk.fault_category} />
      {tk.accessories && <Row k={t.accessories} v={tk.accessories} />}
      {!delivery && <Row k={t.agreed} v={tk.agreed_amount != null ? `${Number(tk.agreed_amount).toFixed(2)} ${t.egp}` : t.afterDiagnosis} />}
      {delivery && (
        <>
          <hr />
          {diag?.fault_found && <Row k={t.work} v={diag.fault_found} />}
          {tk.warranty_final && <Row k={t.warranty} v={d.warranty[tk.warranty_final as keyof typeof d.warranty]} />}
          <Row k={t.paid} v={quote ? `${Number(quote.total).toFixed(2)} ${t.egp}` : t.free} />
          {tk.erp_repair_invoice && <Row k={t.invoice} v={<span dir="ltr">{tk.erp_repair_invoice}</span>} />}
          <Row k={t.collectedAt} v={done ? new Date(done.at).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "short", timeStyle: "short" }) : "—"} />
          {done?.reason && <Row k={t.collectedBy} v={done.reason.replace(/^Collected by:\s*/, "")} />}
        </>
      )}
      <hr />
      <div className="flex flex-col items-center gap-1">
        <span dangerouslySetInnerHTML={{ __html: qr }} />
        <div className="text-center text-[11px]">{t.scan}</div>
      </div>
      <hr />
      <p className="text-[10px]">{delivery ? t.deliveryTerms : t.terms}</p>
      <div className="mt-6 border-b border-black" />
      <div className="text-[11px]">{delivery ? t.signReceived : t.sign}</div>
      <p className="text-center text-[11px] mt-3">{t.thanks}</p>
    </main>
  );
}
