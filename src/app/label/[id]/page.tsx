import { notFound } from "next/navigation";
import { toSVG } from "bwip-js/node";
import { requireSession } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { withDefaults } from "@/lib/receipt-settings";
import { AutoPrint } from "@/app/receipt/[id]/auto-print";

export const metadata = { title: "Pandora Maintenance" };

// Bag label for the label printer: Code 128 barcode of the ticket number, scanned at every custody handover.
// Size (mm) is set in Admin → Receipt.
export default async function LabelPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { t: d, locale } = await getI18n();
  const { id } = await params;
  const supabase = await createClient();
  const { data: rs } = await supabase.from("app_settings").select("value").eq("key", "receipt").maybeSingle();
  const cfg = withDefaults(rs?.value);
  const sample = id === "sample";
  const { data: real } = sample ? { data: null } : await supabase.from("tickets")
    .select("ticket_no, item_name, created_at, branches(name)").eq("id", id).maybeSingle();
  const tk = sample
    ? { ticket_no: "MT-10001", item_name: "Moments Silver Bracelet", created_at: new Date().toISOString(), branches: { name: "Mall of Egypt" } }
    : real;
  if (!tk) notFound();

  const w = cfg.labelWidth, h = cfg.labelHeight;
  const barcode = toSVG({ bcid: "code128", text: tk.ticket_no, height: Math.max(6, h * 0.38), includetext: false, paddingwidth: 0, paddingheight: 0 });
  const store = (tk.branches as unknown as { name: string } | null)?.name ?? "";
  const date = new Date(tk.created_at).toLocaleDateString(locale === "ar" ? "ar-EG" : "en-GB");

  return (
    <>
      <div className="wrap no-print"><AutoPrint label={d.receipt.print} /></div>
      <div className="label" dir={locale === "ar" ? "rtl" : "ltr"}>
      <style>{`
        @page { size: ${w}mm ${h}mm; margin: 0; }
        html, body { margin: 0; background: #fff; }
        .label { width: ${w}mm; height: ${h}mm; box-sizing: border-box; padding: 1.5mm 2mm; color: #000;
          font-family: Arial, sans-serif; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; }
        .label .bc svg { width: 100%; height: ${(h * 0.42).toFixed(1)}mm; display: block; }
        .label .no { font: 800 ${Math.max(9, h * 0.38).toFixed(0)}pt/1 Arial, sans-serif; text-align: center; letter-spacing: .5px; }
        .label .meta { font-size: ${Math.max(5.5, h * 0.2).toFixed(1)}pt; line-height: 1.15; display: flex; justify-content: space-between; gap: 2mm; white-space: nowrap; }
        .label .meta span:first-child { overflow: hidden; text-overflow: ellipsis; }
        @media screen { body { background: #eee; } .label { margin: 16px auto; background: #fff; box-shadow: 0 0 0 1px #bbb; }
          .wrap { max-width: 320px; margin: 16px auto; } }
        @media print { .no-print { display: none; } }
      `}</style>
      <div className="bc" dangerouslySetInnerHTML={{ __html: barcode }} />
      <div className="no" dir="ltr">{tk.ticket_no}</div>
      <div className="meta"><span>{tk.item_name}</span><span>{store}</span></div>
      <div className="meta"><span dir="ltr">{date}</span></div>
      </div>
    </>
  );
}
