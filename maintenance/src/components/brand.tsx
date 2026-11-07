import { withBase } from "@/lib/base";
import { existsSync } from "node:fs";
import path from "node:path";

// Official Pandora mark (crown "O") from public/brand; the name is set beside it.
const FILES = ["pandora-logo.svg", "pandora-logo.png"];
const found = FILES.find((f) => existsSync(path.join(process.cwd(), "public", "brand", f)));

export function Brand({ size = "md", mark = false }: { size?: "md" | "lg"; mark?: boolean }) {
  const lg = size === "lg";
  if (mark && found) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={withBase(`/brand/${found}`)} alt="Pandora" className="h-9 w-auto" />;
  }
  return (
    // Small: the ring of the mark sits on the text baseline, the crown rises above the caps
    <span dir="ltr" className={`inline-flex ${lg ? "flex-col items-center gap-3" : "items-end gap-2"}`} aria-label="Pandora">
      {found && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={withBase(`/brand/${found}`)} alt="" className={`${lg ? "h-16 logo-pop" : "h-[26px] mb-[1px]"} w-auto`} />
      )}
      <span className={`brand-wordmark font-extrabold text-stone-900 leading-none ${lg ? "text-2xl tracking-[0.38em]" : "text-[17px] tracking-[0.3em]"}`}>PANDORA</span>
    </span>
  );
}
