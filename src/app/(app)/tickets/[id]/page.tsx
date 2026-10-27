import { notFound } from "next/navigation";
import QRCode from "qrcode";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { requireSession } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Warranty } from "@/lib/warranty";
import { PrintButton } from "./print-button";
import { waKind, waMessage, waNumber } from "@/lib/whatsapp";
import { ExceptionActions } from "./exception-actions";
import { EXCEPTIONS, type ExceptionTarget } from "./exceptions";

export const metadata = { title: "Pandora Maintenance" };

export default async function TicketPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const me = await requireSession();
  const { t: d, locale } = await getI18n();
  const t = d.ticket;
  const { id } = await params;
  const { created } = await searchParams;
  const supabase = await createClient();

  // RLS returns nothing for tickets outside the user's scope
  const { data: tk } = await supabase
    .from("tickets")
    .select("id, ticket_no, tracking_token, status, item_name, item_code, item_description, item_barcode, item_image, no_invoice, erp_sales_invoice, purchase_date, fault_category, fault_notes, accessories, warranty_provisional, created_at, customer_id, agreed_amount, held_by, held_since, branches(name)")
    .eq("id", id)
    .maybeSingle();
  if (!tk) notFound();

  const { data: customer } = await supabase.from("customers").select("full_name, mobile").eq("id", tk.customer_id).maybeSingle();
  const { data: media } = await supabase.from("ticket_media").select("storage_path").eq("ticket_id", id).eq("stage", "intake");
  const { data: signed } = media?.length
    ? await supabase.storage.from("ticket-media").createSignedUrls(media.map((m) => m.storage_path), 600)
    : { data: [] };

  const trackUrl = `${process.env.APP_BASE_URL ?? ""}/track/${tk.tracking_token}`;
  const qr = await QRCode.toString(trackUrl, { type: "svg", margin: 0, width: 120 });
  const money = (n: number) => n.toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", { minimumFractionDigits: 2 });

  // Same customer + same item repaired before: warn (possible repeat fault / repair warranty)
  const { data: earlier } = tk.item_code
    ? await supabase.from("tickets").select("id, ticket_no, created_at, status").eq("customer_id", tk.customer_id)
        .eq("item_code", tk.item_code).neq("id", tk.id).neq("status", "draft").order("created_at", { ascending: false }).limit(3)
    : { data: [] };

  // Exception steps this user may take from the current status
  const { data: rules } = await supabase.from("status_transitions").select("to_status, allowed_roles, requires_reason")
    .eq("from_status", tk.status).in("to_status", [...EXCEPTIONS]);
  const moves = (rules ?? [])
    .filter((r) => me.fullAccess || (r.allowed_roles as string[]).includes(me.role))
    .filter((r) => !(r.to_status === "ready_to_return" && tk.status !== "unrepairable")) // other returns have their own screens
    .filter((r) => !(r.to_status === "closed" && tk.status !== "lost_in_transit"))
    .map((r) => ({ to: r.to_status as ExceptionTarget, needsReason: r.requires_reason }));
  const branch = (tk.branches as unknown as { name: string } | null)?.name ?? "";

  // WhatsApp message to the customer for the current step, sent from the store's own WhatsApp
  const kind = waKind(tk.status);
  const { data: lastQuote } = kind === "quote"
    ? await supabase.from("quotations").select("total").eq("ticket_id", tk.id).order("sent_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
    : { data: null };
  const waHref = customer?.mobile ? `https://wa.me/${waNumber(customer.mobile)}?text=${encodeURIComponent(waMessage(kind, {
    name: customer.full_name ?? "", ticketNo: tk.ticket_no, item: tk.item_name, store: branch, link: trackUrl,
    quote: lastQuote?.total != null ? money(Number(lastQuote.total)) : undefined,
  }))}` : null;

  // Timeline: every status change, who made it and how long the ticket stayed there
  const { data: hist } = await supabase.from("status_history").select("to_status, user_id, role, reason, at").eq("ticket_id", tk.id).order("at");
  const uids = [...new Set((hist ?? []).map((h) => h.user_id).filter(Boolean))] as string[];
  const { data: people } = uids.length ? await createAdminClient().from("profiles").select("id, full_name").in("id", uids) : { data: [] };
  const who = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  // Custody: who holds the item now (set when the area manager or the receiver scans it)
  const holder = tk.held_by
    ? who.get(tk.held_by) ?? (await createAdminClient().from("profiles").select("full_name, role").eq("id", tk.held_by).maybeSingle()).data?.full_name ?? "—"
    : null;
  const span = (ms: number) => {
    const h = Math.round(ms / 3600_000);
    return h < 1 ? t.timeline.lessHour : h < 48 ? t.timeline.hours(h) : t.timeline.days(Math.round(h / 24));
  };
  const timeline = (hist ?? []).map((h, i, all) => ({
    status: d.status[h.to_status as keyof typeof d.status] ?? h.to_status,
    by: h.user_id ? `${who.get(h.user_id) ?? "—"}${h.role ? ` · ${d.roles[h.role as keyof typeof d.roles] ?? h.role}` : ""}` : null,
    at: new Date(h.at).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short" }),
    took: span((i + 1 < all.length ? new Date(all[i + 1].at).getTime() : Date.now()) - new Date(h.at).getTime()),
    current: i === all.length - 1,
    reason: h.reason,
  }));
  const when = new Date(tk.created_at).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB");

  return (
    <div className="flex flex-col gap-4">
      {created && (
        <div role="status" className="no-print rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 p-4">
          {t.created(tk.ticket_no)}
        </div>
      )}

      {!!earlier?.length && (
        <div role="alert" className="no-print rounded-xl bg-amber-50 border border-amber-200 text-amber-900 p-4 text-sm">
          {t.repeat}{" "}
          {earlier.map((e, i) => (
            <span key={e.id}>{i ? ", " : ""}<Link href={`/tracking?id=${e.id}`} className="font-semibold underline" dir="ltr">{e.ticket_no}</Link>
              {" "}({new Date(e.created_at).toLocaleDateString(locale === "ar" ? "ar-EG" : "en-GB")})</span>
          ))}
        </div>
      )}

      <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-5">
        <div className="flex flex-wrap justify-between gap-3 items-start">
          <div>
            <Brand />
            <h1 className="text-2xl font-semibold mt-1">{t.memo} · <span dir="ltr">{tk.ticket_no}</span></h1>
            <p className="text-sm text-stone-600">{branch} · {when}</p>
          </div>
          <div className="no-print flex flex-wrap gap-2">
            <a href={`/receipt/${tk.id}`} target="_blank" rel="noopener" className="rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-4 py-2 text-sm font-bold">{t.printReceipt}</a>
            {(tk.status === "collected" || tk.status === "closed") && (
              <a href={`/receipt/${tk.id}?kind=delivery`} target="_blank" rel="noopener" className="rounded-lg border border-stone-900 px-4 py-2 text-sm font-bold">{t.printDelivery}</a>
            )}
            {waHref && (
              <a href={waHref} target="_blank" rel="noopener" className="rounded-lg bg-emerald-700 text-white px-4 py-2 text-sm font-bold">{t.whatsapp[kind]}</a>
            )}
            <PrintButton label={t.print} />
          </div>
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
          {holder && (
            <div><dt className="text-stone-500">{t.heldBy}</dt>
              <dd className="font-medium">{holder}{tk.held_since ? <span className="text-stone-500 font-normal"> · {new Date(tk.held_since).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short" })}</span> : null}</dd></div>
          )}
          <div><dt className="text-stone-500">{t.warranty}</dt><dd className="font-medium">{d.warranty[tk.warranty_provisional as Warranty]}</dd></div>
          {tk.fault_notes && <div className="sm:col-span-2"><dt className="text-stone-500">{t.comment}</dt><dd>{tk.fault_notes}</dd></div>}
          {tk.accessories && <div className="sm:col-span-2"><dt className="text-stone-500">{t.accessories}</dt><dd>{tk.accessories}</dd></div>}
          <div><dt className="text-stone-500">{t.agreed}</dt>
            <dd className="font-medium">{tk.agreed_amount != null ? `${money(Number(tk.agreed_amount))} ${t.egp}` : t.noAgreed}</dd></div>
          <div className="sm:col-span-2 flex items-center gap-4">
            <span className="shrink-0 bg-white" aria-label={t.qr} dangerouslySetInnerHTML={{ __html: qr }} />
            <div><dt className="text-stone-500">{t.track}</dt><dd className="text-xs text-stone-600">{t.qrNote}</dd>
              <dd className="font-mono text-xs break-all" dir="ltr">{trackUrl}</dd></div>
          </div>
        </dl>

        {!!signed?.length && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {signed.map((s, i) => s.signedUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={s.signedUrl} alt={t.photoAlt(i + 1)} className="h-32 w-full object-cover rounded-lg border border-stone-200" />
            ))}
          </div>
        )}

        {/* Signed on paper at the counter: the customer accepts the condition, accessories and agreed cost */}
        <div className="grid grid-cols-2 gap-8 pt-6 text-sm">
          <div><div className="border-b border-stone-400 h-10" /><div className="text-stone-600 mt-1">{t.signCustomer}</div></div>
          <div><div className="border-b border-stone-400 h-10" /><div className="text-stone-600 mt-1">{t.signStaff}</div></div>
        </div>
        <p className="text-xs text-stone-500">{t.terms}</p>

        <p className="text-xs text-stone-500 border-t border-stone-200 pt-3">{t.footer(d.status[tk.status] ?? tk.status)}</p>
      </section>

      {!!timeline.length && (
        <section className="no-print bg-white rounded-2xl border border-stone-200 p-6">
          <h2 className="text-lg font-semibold mb-4">{t.timeline.title}</h2>
          <ol className="relative border-s-2 border-stone-200 ms-2 flex flex-col gap-5">
            {timeline.map((e, i) => (
              <li key={i} className="ps-5 relative">
                <span className={`absolute -start-[9px] top-1 w-4 h-4 rounded-full border-2 border-white ${e.current ? "bg-[var(--accent)] ring-4 ring-[var(--accent)]/20" : "bg-stone-400"}`} />
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-semibold">{e.status}</span>
                  <span className="text-xs text-stone-500">{e.at}</span>
                  <span className={`text-xs rounded-full px-2 py-0.5 ${e.current ? "bg-amber-50 text-amber-900" : "bg-stone-100 text-stone-600"}`}>
                    {e.current ? t.timeline.since(e.took) : t.timeline.took(e.took)}
                  </span>
                </div>
                {e.by && <div className="text-sm text-stone-600">{e.by}</div>}
                {e.reason && <div className="text-sm text-stone-700 mt-0.5">“{e.reason}”</div>}
              </li>
            ))}
          </ol>
        </section>
      )}

      <ExceptionActions locale={locale} ticketId={tk.id} moves={moves} />
    </div>
  );
}
