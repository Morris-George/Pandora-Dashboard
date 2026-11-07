"use client";

import { useState, useTransition } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { sendFeedback } from "../actions";

// One-time rating after pickup: 1–5 stars and an optional comment
export function FeedbackForm({ locale, token }: { locale: Locale; token: string }) {
  const t = dictionaries[locale].track;
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);
  const [busy, start] = useTransition();
  if (done) return <p className="text-sm text-emerald-800 font-medium">{t.rateThanks}</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1" role="radiogroup" aria-label={t.rateTitle}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} / 5`} onClick={() => setRating(n)}
            className={`text-3xl leading-none transition ${n <= rating ? "text-amber-500" : "text-stone-300 hover:text-amber-300"}`}>★</button>
        ))}
      </div>
      <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t.rateComment} maxLength={1000}
        className="rounded-lg border border-stone-300 px-3 py-2.5 text-sm" />
      {error && <p role="alert" className="text-sm text-red-800">{t.errors.failed}</p>}
      <button disabled={busy || !rating} className="self-start rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-5 py-2.5 text-sm font-semibold disabled:opacity-40"
        onClick={() => start(async () => { const r = await sendFeedback(token, rating, comment); if (r.error) setError(true); else setDone(true); })}>
        {t.rateSend}
      </button>
    </div>
  );
}
