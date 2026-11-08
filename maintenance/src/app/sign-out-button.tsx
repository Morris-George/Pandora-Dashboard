"use client";

import { useState } from "react";
import { signOut } from "@/app/login/actions";

// Ends the Maintenance session, then leaves for the main site with a full page load (its home page for a
// Super Admin who is also signed in there, its login page for everyone else).
export function SignOutButton({ label }: { label: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="hdr-btn" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await signOut(); } catch { /* leave anyway */ }
      window.location.assign("/");
    }}>{label}</button>
  );
}
