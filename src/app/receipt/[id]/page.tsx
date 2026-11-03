import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { requireSession } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { AutoPrint } from "./auto-print";
import { withDefaults } from "@/lib/receipt-settings";

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
  const { data: rs } = await supabase.from("app_settings").select("value").eq("key", "receipt").maybeSingle();
  const cfg = withDefaults(rs?.value);
  const lang = locale === "ar" ? "ar" : "en";
  const sample = id === "sample"; // Admin preview with made-up data
  const { data: real } = sample ? { data: null } : await supabase.from("tickets")
    .select("id, ticket_no, tracking_token, status, item_name, item_code, fault_category, accessories, agreed_amount, created_at, customer_id, warranty_final, erp_repair_invoice, branches(name, whatsapp)")
    .eq("id", id).maybeSingle();
  const tk = sample ? {
    id: "", ticket_no: "MT-10001", tracking_token: "sample", status: "closed", item_name: "Moments Silver Bracelet", item_code: "590702HV",
    fault_category: "Broken clasp", accessories: "Box", agreed_amount: 500, created_at: new Date().toISOString(), customer_id: "",
    warranty_final: "out_of_warranty", erp_repair_invoice: "ACC-SINV-2026-00001", branches: { name: "Mall of Egypt", whatsapp: "+201000000000" },
  } : real;
  if (!tk) notFound();
  const { data: c } = sample ? { data: { full_name: "Sara Ahmed", mobile: "01001234567" } }
    : await supabase.from("customers").select("full_name, mobile").eq("id", tk.customer_id).maybeSingle();
  const [{ data: diag }, { data: quote }, { data: done }] = sample && delivery
    ? [{ data: { fault_found: "Clasp replaced" } }, { data: { total: 456 } }, { data: { at: new Date().toISOString(), reason: null as string | null } }]
    : delivery && !sample ? await Promise.all([
    supabase.from("diagnoses").select("fault_found").eq("ticket_id", tk.id).maybeSingle(),
    supabase.from("quotations").select("total").eq("ticket_id", tk.id).eq("status", "approved").order("responded_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("status_history").select("at, reason").eq("ticket_id", tk.id).eq("to_status", "collected").order("at", { ascending: false }).limit(1).maybeSingle(),
  ]) : [{ data: null }, { data: null }, { data: null }];

  const url = `${process.env.APP_BASE_URL ?? ""}/track/${tk.tracking_token}`;
  const qr = await QRCode.toString(url, { type: "svg", margin: 0, width: 150 });
  const when = new Date(tk.created_at).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "short", timeStyle: "short" });
  const mobile = cfg.showMobile && c?.mobile ? `${c.mobile.slice(0, 3)}•••••${c.mobile.slice(-3)}` : "";
  const terms = (delivery ? cfg.termsDelivery : cfg.termsIntake)[lang] || (delivery ? t.deliveryTerms : t.terms);
  const footer = cfg.footer[lang] || t.thanks;
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
        {cfg.logo !== "none" && (
          // eslint-disable-next-line @next/next/no-img-element -- printed receipt
          <img src={cfg.logo === "custom" && cfg.customLogo ? cfg.customLogo : "/brand/pandora-logo.png"} alt="" className="mx-auto h-12 w-auto mb-1" />
        )}
        <div className="text-lg font-extrabold tracking-[0.3em]">PANDORA</div>
        {cfg.storeLine && <div className="text-[11px]">{cfg.storeLine}</div>}
        <div>{delivery ? t.deliveryTitle : t.title}</div>
        <div className="text-[11px]">{(tk.branches as unknown as { name: string } | null)?.name} · {when}</div>
        {cfg.showWhatsapp && (tk.branches as unknown as { whatsapp: string | null } | null)?.whatsapp && (
          <div className="text-[11px]">{t.whatsapp}: <span dir="ltr">{(tk.branches as unknown as { whatsapp: string }).whatsapp}</span></div>
        )}
      </div>
      <hr />
      <div className="text-center text-xl font-extrabold" dir="ltr">{tk.ticket_no}</div>
      <hr />
      {cfg.showCustomer && <Row k={t.customer} v={c?.full_name ?? "—"} />}
      {mobile && <Row k={t.mobile} v={<span dir="ltr">{mobile}</span>} />}
      <Row k={t.item} v={tk.item_name} />
      {cfg.showItemCode && tk.item_code && <Row k={t.code} v={<span dir="ltr">{tk.item_code}</span>} />}
      {cfg.showFault && <Row k={t.fault} v={tk.fault_category} />}
      {cfg.showAccessories && tk.accessories && <Row k={t.accessories} v={tk.accessories} />}
      {!delivery && cfg.showAgreed && <Row k={t.agreed} v={tk.agreed_amount != null ? `${Number(tk.agreed_amount).toFixed(2)} ${t.egp}` : t.afterDiagnosis} />}
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
      {cfg.showQr && (
        <>
          <div className="flex flex-col items-center gap-1">
            <span dangerouslySetInnerHTML={{ __html: qr }} />
            {cfg.showScanText && <div className="text-center text-[11px]">{t.scan}</div>}
          </div>
          <hr />
        </>
      )}
      {cfg.showTerms && <p className="text-[10px] whitespace-pre-line">{terms}</p>}
      {cfg.showSignature && (
        <>
          <div className="mt-6 border-b border-black" />
          <div className="text-[11px]">{delivery ? t.signReceived : t.sign}</div>
        </>
      )}
      {cfg.showFooter && <p className="text-center text-[11px] mt-3 whitespace-pre-line">{footer}</p>}
      {(cfg.phone || cfg.website) && <p className="text-center text-[11px]" dir="ltr">{[cfg.phone, cfg.website].filter(Boolean).join(" · ")}</p>}
    </main>
  );
}
