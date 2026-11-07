"use client";

// Friendly fallback instead of a blank screen (e.g. a page left open across an update)
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  const ar = typeof document !== "undefined" && document.documentElement.lang === "ar";
  return (
    <section role="alert" className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-3 items-start">
      <h2 className="text-lg font-semibold">{ar ? "حصلت مشكلة في تحميل الصفحة" : "This page could not load"}</h2>
      <p className="text-sm text-stone-600">{ar ? "غالباً النظام اتحدث. اعمل تحديث للصفحة، ولو المشكلة فضلت كلم الدعم." : "The system was probably just updated. Reload the page; if it keeps happening, contact support."}</p>
      <div className="flex gap-2">
        <button onClick={() => window.location.reload()} className="rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-4 py-2 text-sm font-bold">{ar ? "تحديث الصفحة" : "Reload page"}</button>
        <button onClick={reset} className="rounded-lg border border-stone-900 px-4 py-2 text-sm">{ar ? "حاول تاني" : "Try again"}</button>
      </div>
    </section>
  );
}
