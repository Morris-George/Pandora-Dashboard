"use client";

import { useEffect, useRef } from "react";

// Modal dialog (native <dialog>): replaces the browser's prompt/confirm boxes
export function Dialog({ open, title, onClose, children }: {
  open: boolean; title: string; onClose: () => void; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose}
      className="m-auto w-[min(92vw,28rem)] rounded-2xl border border-stone-200 bg-white p-0 text-stone-900 shadow-xl backdrop:bg-[#2A1018]/40">
      {open && (
        <div className="flex flex-col gap-4 p-6">
          <h2 className="text-lg font-semibold">{title}</h2>
          {children}
        </div>
      )}
    </dialog>
  );
}
