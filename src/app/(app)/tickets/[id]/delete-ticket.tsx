"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { Dialog } from "@/components/dialog";
import { deleteTicket } from "./actions";

// Super Admin only: permanent delete, confirmed by typing the ticket number
export function DeleteTicket({ locale, ticketId, ticketNo }: { locale: Locale; ticketId: string; ticketNo: string }) {
  const t = dictionaries[locale].ticket.remove;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [busy, start] = useTransition();

  return (
    <section className="no-print bg-white rounded-2xl border border-red-200 p-6 flex flex-col gap-3">
      <h2 className="font-semibold">{t.title}</h2>
      <p className="text-sm text-stone-600">{t.note}</p>
      <div>
        <button onClick={() => { setOpen(true); setReason(""); setTyped(""); setError(""); }}
          className="rounded-lg border border-red-800 text-red-800 px-3 py-2 text-sm">{t.button}</button>
      </div>
      <Dialog open={open} title={t.title} onClose={() => setOpen(false)}>
        <p className="text-sm text-stone-600">{t.note}</p>
        <label className="flex flex-col gap-1.5 text-sm font-medium">{t.reason}
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
            className="rounded-lg border border-stone-300 px-3 py-2 font-normal" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">{t.typeNo(ticketNo)}
          <input value={typed} onChange={(e) => setTyped(e.target.value)} dir="ltr"
            className="rounded-lg border border-stone-300 px-3 py-2 font-normal" />
        </label>
        {error && <p role="alert" className="text-sm text-red-800">{error === "mismatch" ? t.mismatch : t.failed}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={() => setOpen(false)} className="rounded-lg border border-stone-300 px-4 py-2 text-sm">{t.cancel}</button>
          <button disabled={busy || !reason.trim() || typed.trim() !== ticketNo}
            onClick={() => start(async () => {
              const r = await deleteTicket(ticketId, reason, typed).catch(() => ({ error: "failed" }));
              if (r.error) setError(r.error); else router.replace("/tickets");
            })}
            className="rounded-lg bg-red-800 text-white px-4 py-2 text-sm font-bold disabled:opacity-40">{t.confirm}</button>
        </div>
      </Dialog>
    </section>
  );
}
