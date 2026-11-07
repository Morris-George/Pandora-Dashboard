"use client";

import { useEffect, useState } from "react";

// Short confirmation after an action: toast() anywhere, <Toaster /> once in the layout
export function toast(message?: string) {
  window.dispatchEvent(new CustomEvent("app-toast", { detail: message }));
}

export function Toaster({ fallback }: { fallback: string }) {
  const [msg, setMsg] = useState<{ text: string; id: number } | null>(null);
  useEffect(() => {
    const on = (e: Event) => setMsg({ text: (e as CustomEvent<string | undefined>).detail || fallback, id: Date.now() });
    window.addEventListener("app-toast", on);
    return () => window.removeEventListener("app-toast", on);
  }, [fallback]);
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(null), 3000);
    return () => clearTimeout(id);
  }, [msg]);
  return (
    <div role="status" aria-live="polite" className="no-print fixed bottom-6 inset-x-0 z-50 flex justify-center pointer-events-none">
      {msg && (
        <span key={msg.id} className="toast-in rounded-full bg-emerald-800 text-white px-5 py-2.5 text-sm font-semibold shadow-lg">{msg.text}</span>
      )}
    </div>
  );
}
