// Shown while a screen loads: a soft placeholder instead of a frozen page
export default function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4 animate-pulse">
      <div className="h-24 rounded-2xl bg-white border border-stone-200" />
      <div className="h-48 rounded-2xl bg-white border border-stone-200" />
      <div className="h-32 rounded-2xl bg-white border border-stone-200" />
    </div>
  );
}
