"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { respond } from "../actions";

const input = "rounded-lg border border-stone-300 px-3 py-2.5 text-sm focus:outline-2 focus:outline-stone-900";

export function QuoteResponse({ locale, token }: { locale: Locale; token: string }) {
  const t = dictionaries[locale].track;
  const router = useRouter();
  const [busy, start] = useTransition();
  const [last4, setLast4] = useState("");
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState("");
  const ok = /^\d{4}$/.test(last4);

  const send = (approve: boolean) =>
    start(async () => {
      setError("");
      const r = await respond(token, last4, approve, reason);
      if (r.error) { setError(t.errors[r.error] ?? t.errors.failed); return; }
      router.refresh();
    });

  return (
    <div className="rounded-xl bg-stone-50 border border-stone-200 p-4 flex flex-col gap-3">
      <p className="text-sm">{t.quoteAsk}</p>
      <label className="flex flex-col gap-1.5 text-sm font-medium">{t.last4}
        <input value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" dir="ltr" className={`${input} w-28 tracking-widest`} />
      </label>
      {rejecting && (
        <label className="flex flex-col gap-1.5 text-sm font-medium">{t.rejectReason}
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={input} />
        </label>
      )}
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {!rejecting ? (
          <>
            <button disabled={busy || !ok} aria-busy={busy} onClick={() => send(true)} className="rounded-lg bg-emerald-800 text-white px-5 py-2.5 text-sm font-semibold disabled:opacity-40">{t.approve}</button>
            <button disabled={busy} onClick={() => setRejecting(true)} className="rounded-lg border border-stone-400 px-5 py-2.5 text-sm">{t.reject}</button>
          </>
        ) : (
          <>
            <button disabled={busy || !ok} aria-busy={busy} onClick={() => send(false)} className="rounded-lg border border-red-800 text-red-800 px-5 py-2.5 text-sm font-semibold disabled:opacity-40">{t.confirmReject}</button>
            <button disabled={busy} onClick={() => setRejecting(false)} className="rounded-lg border border-stone-400 px-5 py-2.5 text-sm">{t.back}</button>
          </>
        )}
      </div>
      <p className="text-xs text-stone-500">{t.quoteNote}</p>
    </div>
  );
}
