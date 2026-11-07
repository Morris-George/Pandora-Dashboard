import { notFound } from "next/navigation";
import { toSVG } from "bwip-js/node";
import { requireSession } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { withDefaults } from "@/lib/receipt-settings";
import { AutoPrint } from "@/app/receipt/[id]/auto-print";

export const metadata = { title: "Pandora Maintenance" };

// AWB label for the sealed bag: Code 128 barcode of the AWB number, scanned by the courier and the receiver.
// Same label size as the ticket bag label (Admin → Receipt).
export default async function AwbLabelPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { t: d, locale } = await getI18n();
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: rs }, { data: b }] = await Promise.all([
    supabase.from("app_settings").select("value").eq("key", "receipt").maybeSingle(),
    supabase.from("dispatch_batches").select("batch_no, seal_no, direction, created_at, branches(name), batch_items(ticket_id)").eq("id", id).maybeSingle(),
  ]);
  if (!b) notFound();
  const cfg = withDefaults(rs?.value);
  const t = d.dispatch;

  const w = cfg.labelWidth, h = cfg.labelHeight;
  const barcode = toSVG({ bcid: "code128", text: b.seal_no, height: Math.max(6, h * 0.36), includetext: false, paddingwidth: 0, paddingheight: 0 });
  const store = (b.branches as unknown as { name: string } | null)?.name ?? "";
  const date = new Date(b.created_at).toLocaleDateString(locale === "ar" ? "ar-EG" : "en-GB");
  const items = (b.batch_items as unknown as unknown[] | null)?.length ?? 0;

  return (
    <>
      <div className="wrap no-print"><AutoPrint label={d.receipt.print} /></div>
      <div className="label" dir={locale === "ar" ? "rtl" : "ltr"}>
      <style>{`
        @page { size: ${w}mm ${h}mm; margin: 0; }
        html, body { margin: 0; background: #fff; }
        .label { width: ${w}mm; height: ${h}mm; box-sizing: border-box; padding: 1.5mm 2mm; color: #000;
          font-family: Arial, sans-serif; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; }
        .label .bc svg { width: 100%; height: ${(h * 0.4).toFixed(1)}mm; display: block; }
        .label .no { font: 800 ${Math.max(8, h * 0.3).toFixed(0)}pt/1 Arial, sans-serif; text-align: center; letter-spacing: .3px; }
        .label .meta { font-size: ${Math.max(5.5, h * 0.2).toFixed(1)}pt; line-height: 1.15; display: flex; justify-content: space-between; gap: 2mm; white-space: nowrap; }
        @media screen { body { background: #eee; } .label { margin: 16px auto; background: #fff; box-shadow: 0 0 0 1px #bbb; }
          .wrap { max-width: 320px; margin: 16px auto; } }
        @media print { .no-print { display: none; } }
      `}</style>
      <div className="bc" dangerouslySetInnerHTML={{ __html: barcode }} />
      <div className="no" dir="ltr">{b.seal_no}</div>
      <div className="meta"><span dir="ltr">{b.batch_no}</span><span>{b.direction === "outbound" ? t.outbound : t.return} · {store}</span></div>
      <div className="meta"><span>{t.items}: {items}</span><span>{date}</span></div>
      </div>
    </>
  );
}
