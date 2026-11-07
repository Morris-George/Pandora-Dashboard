// The Maintenance app is served at pandora-eg.online/maintenance (next.config.ts basePath).
// Next adds the base path to <Link>, router calls and redirect(); plain <a href>, <img src>, <form action>,
// fetch and window.location do not, so they go through withBase().
export const BASE_PATH = "/maintenance";
// "/" becomes "/maintenance" (no trailing slash): the dashboard site only forwards /maintenance and /maintenance/<page> here
export const withBase = (p: string) => (p === "/" ? BASE_PATH : p.startsWith("/") && !p.startsWith(BASE_PATH + "/") && p !== BASE_PATH ? BASE_PATH + p : p);

// Middleware needs an absolute Location. Behind the dashboard site the visitor's host arrives in x-forwarded-host;
// the project's own vercel.app address is never shown to people, so it maps to the main domain.
export function siteOrigin(h: { get(name: string): string | null }): string {
  const host = (h.get("x-forwarded-host") || h.get("host") || "").split(",")[0].trim();
  if (!host || host.endsWith(".vercel.app") || host.startsWith("localhost")) return host.startsWith("localhost") ? "http://" + host : "https://pandora-eg.online";
  return "https://" + host;
}
