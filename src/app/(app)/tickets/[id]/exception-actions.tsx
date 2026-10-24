"use client";

import { useState, useTransition } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { Dialog } from "@/components/dialog";
import { exceptionMove } from "./actions";
import type { ExceptionTarget } from "./exceptions";

type Move = { to: ExceptionTarget; needsReason: boolean };

// Cancel / lost in transit / close lost item / send an unrepairable piece back
export function ExceptionActions({ locale, ticketId, moves }: { locale: Locale; ticketId: string; moves: Move[] }) {
  const t = dictionaries[locale].ticket.exceptions;
  const [open, setOpen] = useState<Move | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, start] = useTransition();
  if (!moves.length) return null;

  return (
    <section className="no-print bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-3">
      <h2 className="font-semibold">{t.title}</h2>
      <div className="flex flex-wrap gap-2">
        {moves.map((m) => (
          <button key={m.to} onClick={() => { setOpen(m); setReason(""); setError(""); }}
            className={`rounded-lg border px-3 py-2 text-sm ${m.to === "ready_to_return" ? "border-stone-900" : "border-red-800 text-red-800"}`}>
            {t.labels[m.to]}
          </button>
        ))}
      </div>
      <Dialog open={!!open} title={open ? t.labels[open.to] : ""} onClose={() => setOpen(null)}>
        <p className="text-sm text-stone-600">{open && t.notes[open.to]}</p>
        <label className="flex flex-col gap-1.5 text-sm font-medium">{open?.needsReason ? t.reasonRequired : t.reasonOptional}
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
            className="rounded-lg border border-stone-300 px-3 py-2 font-normal" />
        </label>
        {error && <p role="alert" className="text-sm text-red-800">{t.errors[error] ?? t.errors.failed}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={() => setOpen(null)} className="rounded-lg border border-stone-300 px-4 py-2 text-sm">{t.cancel}</button>
          <button disabled={busy || (!!open?.needsReason && !reason.trim())}
            onClick={() => open && start(async () => {
              const r = await exceptionMove(ticketId, open.to, reason).catch(() => ({ error: "failed" }));
              if (r.error) setError(r.error); else setOpen(null);
            })}
            className="rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-4 py-2 text-sm font-bold disabled:opacity-40">{t.confirm}</button>
        </div>
      </Dialog>
    </section>
  );
}
