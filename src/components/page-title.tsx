"use client";

import { usePathname } from "next/navigation";

// Banner title follows the current screen (same pattern as the Dashboards header)
export function PageTitle({ titles, fallback }: { titles: Record<string, string>; fallback: string }) {
  const path = usePathname();
  const key = Object.keys(titles).find((k) => path === k || path.startsWith(`${k}/`));
  return <h1 key={path} className="hdr-pop text-[26px] leading-tight !font-extrabold tracking-tight text-[#2A1018]">{key ? titles[key] : fallback} <span aria-hidden className="sparkle text-lg align-middle">✦</span></h1>;
}
