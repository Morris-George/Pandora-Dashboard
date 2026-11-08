"use client";

import { useEffect, useState } from "react";

// Sun / moon switch, the same as on the Pandora Dashboards. The choice is kept under the same browser key
// ("pandora-theme") on the same site, so a change here also applies on the dashboards and the other way round.
export function ThemeSwitch({ fixed = false }: { fixed?: boolean }) {
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.getAttribute("data-theme") === "dark"); }, []);
  const toggle = () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("pandora-theme", next); } catch { /* private mode */ }
    setDark(next === "dark");
  };
  return (
    <button type="button" role="switch" aria-checked={dark} onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} title={dark ? "Light mode" : "Dark mode"}
      className={`pandora-sw no-print${dark ? " is-dark" : ""}${fixed ? " fixed" : ""}`}>
      <span className="pknob">
        <svg className="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <circle cx="12" cy="12" r="4.2" fill="currentColor" />
          <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M18.7 5.3L17 7M7 17l-1.7 1.7" />
        </svg>
        <svg className="moon" viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1z" /></svg>
      </span>
    </button>
  );
}
