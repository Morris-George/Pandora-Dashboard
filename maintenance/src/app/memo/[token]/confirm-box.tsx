"use client";

import { useState, useTransition } from "react";
import { withBase } from "@/lib/base";
import { confirmMemo } from "./actions";

// Above the customer's receipt: the confirm button (once) and the PDF download. Hidden in print / PDF.
export function ConfirmBox({ token, kind, at, canConfirm, l }: {
  token: string; kind: "intake" | "pickup"; at: string | null; canConfirm: boolean;
  l: { confirm: string; confirmed: string; failed: string; pdf: string; locale: string };
}) {
  const [done, setDone] = useState(at);
  const [err, setErr] = useState("");
  const [busy, start] = useTransition();
  const fmt = (s: string) => new Date(s).toLocaleString(l.locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "short", timeStyle: "short" });
  return (
    <div className="no-print mx-auto mt-4 flex w-[80mm] max-w-full flex-col gap-2 px-1">
      {done ? (
        <p className="rounded-lg bg-emerald-50 border border-emerald-300 px-3 py-2.5 text-center text-sm font-semibold text-emerald-900">✓ {l.confirmed} · {fmt(done)}</p>
      ) : canConfirm && (
        <button disabled={busy} onClick={() => start(async () => { setErr(""); const r = await confirmMemo(token, kind); if (r.at) setDone(r.at); else setErr(l.failed); })}
          className="rounded-lg bg-emerald-700 py-3 text-base font-bold text-white disabled:opacity-60">{l.confirm}</button>
      )}
      {err && <p role="alert" className="text-center text-sm text-red-800">{err}</p>}
      <a href={withBase(`/memo/${token}/pdf${kind === "pickup" ? "?kind=delivery" : ""}`)} className="rounded-lg border border-black py-2 text-center text-sm font-semibold">{l.pdf}</a>
    </div>
  );
}
