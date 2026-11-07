// The Maintenance app is served at pandora-eg.online/maintenance (next.config.ts basePath).
// Next adds the base path to <Link>, router calls and redirect(); plain <a href>, <img src>, <form action>,
// fetch and window.location do not, so they go through withBase().
export const BASE_PATH = "/maintenance";
export const withBase = (p: string) => (p.startsWith("/") && !p.startsWith(BASE_PATH + "/") && p !== BASE_PATH ? BASE_PATH + p : p);
