"use client";

export function PrintButton({ label }: { label: string }) {
  return (
    <button onClick={() => window.print()} className="no-print rounded-lg border border-stone-900 px-4 py-2 text-sm font-medium">
      {label}
    </button>
  );
}
