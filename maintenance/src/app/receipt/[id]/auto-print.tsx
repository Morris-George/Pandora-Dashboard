"use client";

import { useEffect } from "react";

// Opens the print dialog once the receipt has rendered; the button is there to reprint
export function AutoPrint({ label, auto = true }: { label: string; auto?: boolean }) {
  useEffect(() => {
    if (!auto) return;
    const id = setTimeout(() => window.print(), 300);
    return () => clearTimeout(id);
  }, [auto]);
  return (
    <button onClick={() => window.print()} className="no-print mb-3 w-full rounded-lg border border-black py-2 text-sm font-semibold">
      {label}
    </button>
  );
}
