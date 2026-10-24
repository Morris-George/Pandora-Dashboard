"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { createClient } from "@/lib/supabase/client";

const input = "rounded-lg border border-stone-300 px-3 py-2.5 font-normal tracking-[0.4em] text-center text-lg focus:outline-2 focus:outline-stone-900";

export function MfaForm({ locale }: { locale: Locale }) {
  const t = dictionaries[locale].mfa;
  const router = useRouter();
  const [factorId, setFactorId] = useState("");
  const [qr, setQr] = useState(""); // shown only while setting up
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      const verified = data?.totp?.find((f) => f.status === "verified");
      if (verified) { setFactorId(verified.id); setBusy(false); return; }
      // Remove half-finished setups, then start a new one
      for (const f of data?.all ?? []) if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data: en, error: e } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Pandora Maintenance" });
      if (e || !en) { setError(t.failed); setBusy(false); return; }
      setFactorId(en.id); setQr(en.totp.qr_code); setSecret(en.totp.secret); setBusy(false);
    })();
  }, [t.failed]);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    const { error: err } = await createClient().auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    if (err) { setError(t.wrong); setBusy(false); return; }
    router.replace("/");
    router.refresh();
  };

  return (
    <form onSubmit={verify} className="flex flex-col gap-4 mt-2">
      <p className="text-sm text-stone-600">{qr ? t.setupNote : t.enterNote}</p>
      {qr && (
        <div className="flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- data: URL from Supabase */}
          <img src={qr} alt={t.qrAlt} width={180} height={180} className="rounded-lg border border-stone-200 bg-white p-2" />
          <span className="text-xs text-stone-500">{t.orKey}</span>
          <code dir="ltr" className="text-xs bg-stone-50 rounded px-2 py-1 select-all break-all">{secret}</code>
        </div>
      )}
      <label className="flex flex-col gap-1.5 text-sm font-medium">{t.code}
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric"
          autoComplete="one-time-code" required minLength={6} maxLength={6} dir="ltr" autoFocus className={input} />
      </label>
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      <button disabled={busy || code.length !== 6 || !factorId} className="rounded-lg bg-[var(--accent)] text-[var(--on-accent)] py-3 font-semibold disabled:opacity-50">
        {busy ? t.checking : t.verify}
      </button>
    </form>
  );
}
