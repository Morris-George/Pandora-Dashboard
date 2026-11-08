"use client";

import { useState } from "react";
import { signOut } from "@/app/login/actions";

// Signs out entirely: ends the Maintenance session and the main site's sign-in too (same browser, same domain),
// then opens the login page with a full page load.
export function SignOutButton({ label }: { label: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="hdr-btn" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await signOut(); } catch { /* leave anyway */ }
      try { await fetch("/api/logout", { method: "POST", credentials: "same-origin" }); } catch { /* leave anyway */ }
      window.location.assign("/login.html");
    }}>{label}</button>
  );
}
