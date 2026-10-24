import { notFound } from "next/navigation";
import { Brand } from "@/components/brand";
import { requireSession } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import type { Warranty } from "@/lib/warranty";
import { PrintButton } from "./print-button";

export const metadata = { title: "Pandora Maintenance" };

export default async function TicketPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  await requireSession();
  const { t: d, locale } = await getI18n();
  const t = d.ticket;
  const { id } = await params;
  const { created } = await searchParams;
  const supabase = await createClient();

  // RLS returns nothing for tickets outside the user's scope
  const { data: tk } = await supabase
    .from("tickets")
    .select("id, ticket_no, tracking_token, status, item_name, item_code, item_description, item_barcode, item_image, no_invoice, erp_sales_invoice, purchase_date, fault_category, fault_notes, accessories, warranty_provisional, created_at, customer_id, branches(name)")
    .eq("id", id)
    .maybeSingle();
  if (!tk) notFound();

  const { data: customer } = await supabase.from("customers").select("full_name, mobile").eq("id", tk.customer_id).maybeSingle();
  const { data: media } = await supabase.from("ticket_media").select("storage_path").eq("ticket_id", id).eq("stage", "intake");
  const { data: signed } = media?.length
    ? await supabase.storage.from("ticket-media").createSignedUrls(media.map((m) => m.storage_path), 600)
    : { data: [] };

  const trackUrl = `${process.env.APP_BASE_URL ?? ""}/track/${tk.tracking_token}`;
  const branch = (tk.branches as unknown as { name: string } | null)?.name ?? "";
  const when = new Date(tk.created_at).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB");

  return (
    <div className="flex flex-col gap-4">
      {created && (
        <div role="status" className="no-print rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 p-4">
          {t.created(tk.ticket_no)}
        </div>
      )}

      <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-5">
        <div className="flex flex-wrap justify-between gap-3 items-start">
          <div>
            <Brand />
            <h1 className="text-2xl font-semibold mt-1">{t.memo} · <span dir="ltr">{tk.ticket_no}</span></h1>
            <p className="text-sm text-stone-600">{branch} · {when}</p>
          </div>
          <PrintButton label={t.print} />
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div><dt className="text-stone-500">{t.customer}</dt><dd className="font-medium">{customer?.full_name ?? "—"}</dd></div>
          <div><dt className="text-stone-500">{t.mobile}</dt><dd className="font-medium" dir="ltr">{customer?.mobile ?? t.mobileHidden}</dd></div>
          <div className="flex gap-3">
            {tk.item_image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/erp-image?path=${encodeURIComponent(tk.item_image)}`} alt="" className="h-16 w-16 object-contain rounded border border-stone-200" />
            )}
            <div><dt className="text-stone-500">{t.item}</dt>
              <dd className="font-medium">{tk.item_name}{tk.item_code ? <span dir="ltr"> · {tk.item_code}</span> : ""}</dd>
              {tk.item_description && <dd className="text-stone-600">{tk.item_description}</dd>}
            </div>
          </div>
          {tk.item_barcode && <div><dt className="text-stone-500">{t.barcode}</dt><dd className="font-medium" dir="ltr">{tk.item_barcode}</dd></div>}
          <div><dt className="text-stone-500">{t.invoice}</dt><dd className="font-medium">{tk.no_invoice ? t.noInvoice : <>{tk.erp_sales_invoice ?? "—"}{tk.purchase_date ? ` · ${tk.purchase_date}` : ""}</>}</dd></div>
          <div><dt className="text-stone-500">{t.fault}</dt><dd className="font-medium">{tk.fault_category}</dd></div>
          <div><dt className="text-stone-500">{t.warranty}</dt><dd className="font-medium">{d.warranty[tk.warranty_provisional as Warranty]}</dd></div>
          {tk.fault_notes && <div className="sm:col-span-2"><dt className="text-stone-500">{t.comment}</dt><dd>{tk.fault_notes}</dd></div>}
          {tk.accessories && <div className="sm:col-span-2"><dt className="text-stone-500">{t.accessories}</dt><dd>{tk.accessories}</dd></div>}
          <div className="sm:col-span-2"><dt className="text-stone-500">{t.track}</dt><dd className="font-mono break-all" dir="ltr">{trackUrl}</dd></div>
        </dl>

        {!!signed?.length && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {signed.map((s, i) => s.signedUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={s.signedUrl} alt={t.photoAlt(i + 1)} className="h-32 w-full object-cover rounded-lg border border-stone-200" />
            ))}
          </div>
        )}

        <p className="text-xs text-stone-500 border-t border-stone-200 pt-3">{t.footer(d.status[tk.status] ?? tk.status)}</p>
      </section>
    </div>
  );
}
