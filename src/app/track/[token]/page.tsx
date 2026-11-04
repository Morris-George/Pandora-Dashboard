import Link from "next/link";
import { getI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { LangToggle } from "@/app/lang-toggle";
import { Brand } from "@/components/brand";
import { QuoteResponse } from "./quote-response";

export const metadata = { title: "Pandora — Track your repair", robots: { index: false } };

// Customer-facing steps (BRD 8); staff statuses map onto these
const STEP: Record<string, number> = {
  received_at_branch: 0, awaiting_dispatch: 0, in_transit_to_hq: 1,
  received_at_hq: 2, under_diagnosis: 2, awaiting_customer_approval: 2,
  in_repair: 3, awaiting_parts: 3, quality_check: 3, quote_rejected: 3, unrepairable: 3,
  ready_to_return: 4, in_transit_to_branch: 4, ready_for_pickup: 5, uncollected: 5, collected: 6, closed: 6,
};

type Tracked = {
  ticket_no: string; item_name: string; status: string; branch: string; branch_whatsapp: string | null; first_name: string; created_at: string;
  warranty: string; amount_due: number; history: { status: string; at: string }[];
  quote: { status: string; lines: { desc: string; qty: number; price: number }[]; subtotal: number; tax: number; total: number } | null;
};

export default async function TrackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t: d, locale } = await getI18n();
  const t = d.track;
  const supabase = await createClient();
  const { data } = /^[0-9a-f]{32}$/.test(token) ? await supabase.rpc("track_ticket", { p_token: token }) : { data: null };
  const tk = data as Tracked | null;
  // Contact line from Admin → Customer page contact (customers aren't signed in, so read it server-side)
  const { data: cc } = await createAdminClient().from("app_settings").select("value").eq("key", "customer_contact").maybeSingle();
  const contact = (cc?.value ?? {}) as { en?: string; ar?: string; phone?: string; email?: string };
  const loc = locale === "ar" ? "ar-EG" : "en-GB";
  const fmt = (s: string) => new Date(s).toLocaleString(loc, { dateStyle: "medium", timeStyle: "short" });
  const money = (n: number) => Number(n).toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const shell = (body: React.ReactNode) => (
    <main className="relative min-h-screen px-4 py-8 overflow-hidden">
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(60rem_40rem_at_20%_-10%,#efe3e4,transparent),radial-gradient(50rem_30rem_at_110%_110%,#ece9e4,transparent)]" />
      <div className="mx-auto w-full max-w-lg flex flex-col gap-5">
        <div className="flex items-center justify-between rise"><Brand /><LangToggle label={d.switchTo} className="border-stone-200 bg-white/80 hover:bg-white" /></div>
        {body}
        <p className="text-xs text-stone-500 text-center flex flex-wrap justify-center gap-x-3">
          <span>{(locale === "ar" ? contact.ar : contact.en) || t.help}</span>
          {contact.phone && <a href={`tel:${contact.phone.replace(/[^0-9+]/g, "")}`} dir="ltr" className="underline">{contact.phone}</a>}
          {contact.email && <a href={`mailto:${contact.email}`} dir="ltr" className="underline">{contact.email}</a>}
        </p>
      </div>
    </main>
  );

  if (!tk) {
    return shell(
      <section className="rise bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-3">
        <h1 className="text-lg font-semibold">{t.notFoundTitle}</h1>
        <p className="text-sm text-stone-600">{t.notFoundNote}</p>
        <Link href="/track" className="self-start rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-4 py-2 text-sm font-semibold">{t.searchAgain}</Link>
      </section>,
    );
  }

  const step = STEP[tk.status] ?? 0;
  const stopped = ["lost_in_transit", "cancelled"].includes(tk.status);
  const lastAt = tk.history.length ? tk.history[tk.history.length - 1].at : tk.created_at;
  const waitingQuote = tk.status === "awaiting_customer_approval" && tk.quote?.status === "sent";
  const tone = stopped ? "bg-red-50 border-red-200" : waitingQuote ? "bg-amber-50 border-amber-200"
    : tk.status === "ready_for_pickup" ? "bg-emerald-50 border-emerald-200" : "bg-stone-50 border-stone-200";

  return shell(
    <>
      <section className="rise bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4">
        <div>
          <p className="text-sm text-stone-500">{t.hello(tk.first_name)}</p>
          <h1 className="text-xl font-semibold mt-1">{tk.item_name}</h1>
          <p className="text-sm text-stone-600"><span dir="ltr">{tk.ticket_no}</span> · {tk.branch}</p>
          {tk.branch_whatsapp && (
            <a href={`https://wa.me/${tk.branch_whatsapp.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(tk.ticket_no)}`} target="_blank" rel="noopener"
              className="inline-flex mt-2 rounded-lg bg-emerald-700 text-white px-3 py-1.5 text-sm font-semibold">{t.whatsapp}</a>
          )}
        </div>
        <div className={`rounded-xl p-4 border ${tone}`}>
          <div className="font-semibold">{t.status[tk.status] ?? t.status.default}</div>
          <div className="text-sm text-stone-600 mt-1">{t.statusNote[tk.status] ?? ""}</div>
          <div className="text-xs text-stone-500 mt-2">{t.updated(fmt(lastAt))}</div>
        </div>
        {!stopped && (
          <ol className="flex flex-col" aria-label={t.progress}>
            {t.steps.map((s, i) => (
              <li key={s} className="flex gap-3 items-start">
                <div className="flex flex-col items-center">
                  <span className={`w-6 h-6 rounded-full grid place-items-center text-xs font-semibold
                    ${i < step ? "bg-[var(--accent)] text-[var(--on-accent)]" : i === step ? "bg-[var(--accent-strong)] text-white ring-4 ring-[var(--accent)]/40" : "bg-stone-200 text-stone-500"}`}>
                    {i < step ? "✓" : i + 1}
                  </span>
                  {i < t.steps.length - 1 && <span className={`w-px h-6 ${i < step ? "bg-stone-900" : "bg-stone-200"}`} />}
                </div>
                <span className={`text-sm pt-0.5 ${i === step ? "font-semibold" : i < step ? "text-stone-700" : "text-stone-400"}`}>{s}</span>
              </li>
            ))}
          </ol>
        )}
        {tk.status === "ready_for_pickup" && (
          <p className="text-sm">{Number(tk.amount_due) > 0 ? t.payAtPickup(money(tk.amount_due)) : t.freePickup}</p>
        )}
      </section>

      {tk.quote && (
        <section className="rise bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t.quoteTitle}</h2>
          <table className="w-full text-sm">
            <tbody>
              {tk.quote.lines.map((l, i) => (
                <tr key={i} className="border-t border-stone-100">
                  <td className="py-1.5">{l.desc}{l.qty !== 1 && <span className="text-stone-500"> × {l.qty}</span>}</td>
                  <td className="py-1.5 text-end tabular-nums">{money(l.qty * l.price)}</td>
                </tr>
              ))}
              <tr className="border-t border-stone-200 text-stone-600"><td className="py-1.5">{t.vat}</td><td className="py-1.5 text-end tabular-nums">{money(tk.quote.tax)}</td></tr>
              <tr className="font-semibold"><td className="py-1.5">{t.total}</td><td className="py-1.5 text-end tabular-nums">{money(tk.quote.total)}</td></tr>
            </tbody>
          </table>
          {waitingQuote ? <QuoteResponse locale={locale} token={token} /> : (
            <p className="text-sm text-stone-600">{t.quoteState[tk.quote.status] ?? ""}</p>
          )}
        </section>
      )}

    </>,
  );
}
