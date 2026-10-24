import { toggleLocale } from "@/lib/i18n/actions";

export function LangToggle({ label, className = "" }: { label: string; className?: string }) {
  return (
    <form action={toggleLocale}>
      <button className={className.includes("hdr-btn") ? className : `rounded-lg border px-3 py-1.5 text-xs ${className}`}>{label}</button>
    </form>
  );
}
