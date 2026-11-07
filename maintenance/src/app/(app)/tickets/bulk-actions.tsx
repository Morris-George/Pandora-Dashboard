"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { Dialog } from "@/components/dialog";
import { deleteTicket } from "./[id]/actions";
import { setTicketsStatus } from "./actions";

type Picked = { id: string; no: string };

// Super Admin: tick tickets in the list (checkboxes in the table), then change their status or delete them
export function BulkActions({ locale, formId, statuses }: { locale: Locale; formId: string; statuses: string[] }) {
  const d = dictionaries[locale];
  const t = d.list.bulk;
  const router = useRouter();
  const [picked, setPicked] = useState<Picked[]>([]);
  const [mode, setMode] = useState<"status" | "delete" | null>(null);
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [busy, start] = useTransition();

  // Read the ticked rows from the table
  useEffect(() => {
    const form = document.getElementById(formId);
    if (!form) return;
    const read = () => setPicked([...form.querySelectorAll<HTMLInputElement>("input[data-bulk]:checked")].map((i) => ({ id: i.value, no: i.dataset.no ?? "" })));
    form.addEventListener("change", read);
    read();
    return () => form.removeEventListener("change", read);
  }, [formId]);

  const open = (m: "status" | "delete") => { setMode(m); setReason(""); setTyped(""); setError(""); setTo(""); };
  const done = () => {
    setMode(null);
    document.getElementById(formId)?.querySelectorAll<HTMLInputElement>("input[data-bulk]").forEach((i) => { i.checked = false; });
    setPicked([]);
    router.refresh();
  };
  const word = t.deleteWord;
  // Tick or untick every row in the table
  const tickAll = (on: boolean) => {
    const form = document.getElementById(formId);
    form?.querySelectorAll<HTMLInputElement>("input[data-bulk]").forEach((i) => { i.checked = on; });
    form?.dispatchEvent(new Event("change"));
  };

  return (
    <div className="no-print flex flex-wrap items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm">
      <span className="font-medium">{t.selected(picked.length)}</span>
      <button onClick={() => tickAll(true)} className="rounded-lg border border-stone-300 px-3 py-1.5">{t.selectAll}</button>
      <button disabled={!picked.length} onClick={() => tickAll(false)} className="rounded-lg border border-stone-300 px-3 py-1.5 disabled:opacity-40">{t.unselectAll}</button>
      <button disabled={!picked.length} onClick={() => open("status")}
        className="rounded-lg border border-stone-900 px-3 py-1.5 font-bold disabled:opacity-40">{t.changeStatus}</button>
      <button disabled={!picked.length} onClick={() => open("delete")}
        className="rounded-lg border border-red-800 text-red-800 px-3 py-1.5 font-bold disabled:opacity-40">{t.delete}</button>

      <Dialog open={!!mode} title={mode === "delete" ? t.delete : t.changeStatus} onClose={() => setMode(null)}>
        <p className="text-sm text-stone-600" dir="ltr">{picked.map((p) => p.no).join(", ")}</p>
        <p className="text-sm text-stone-600">{mode === "delete" ? t.deleteNote : t.statusNote}</p>
        {mode === "status" && (
          <label className="flex flex-col gap-1.5 text-sm font-medium">{t.newStatus}
            <select value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-stone-300 px-3 py-2 font-normal">
              <option value="">—</option>
              {statuses.map((s) => <option key={s} value={s}>{d.status[s]}</option>)}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1.5 text-sm font-medium">{t.reason}
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="rounded-lg border border-stone-300 px-3 py-2 font-normal" />
        </label>
        {mode === "delete" && (
          <label className="flex flex-col gap-1.5 text-sm font-medium">{t.typeWord(word)}
            <input value={typed} onChange={(e) => setTyped(e.target.value)} className="rounded-lg border border-stone-300 px-3 py-2 font-normal" />
          </label>
        )}
        {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={() => setMode(null)} className="rounded-lg border border-stone-300 px-4 py-2 text-sm">{t.cancel}</button>
          <button
            disabled={busy || !reason.trim() || (mode === "status" ? !to : typed.trim() !== word)}
            onClick={() => start(async () => {
              setError("");
              if (mode === "status") {
                const r = await setTicketsStatus(picked.map((p) => p.id), to, reason).catch(() => ({ error: "failed" }));
                if (r.error) setError(t.failed); else done();
              } else {
                for (const p of picked) {
                  const r = await deleteTicket(p.id, reason, p.no).catch(() => ({ error: "failed" }));
                  if (r.error) { setError(`${t.failed} (${p.no})`); router.refresh(); return; }
                }
                done();
              }
            })}
            className={`rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-40 ${mode === "delete" ? "bg-red-800" : "bg-stone-900"}`}>
            {mode === "delete" ? t.confirmDelete(picked.length) : t.confirmStatus(picked.length)}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
