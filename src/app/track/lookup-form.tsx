"use client";

import { useActionState } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { lookup, type LookupState } from "./actions";

const input = "rounded-lg border border-stone-300 px-3 py-2.5 font-normal focus:outline-2 focus:outline-stone-900";

export function LookupForm({ locale }: { locale: Locale }) {
  const t = dictionaries[locale].track;
  const [state, action, pending] = useActionState<LookupState, FormData>(lookup, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm font-medium">{t.ticketNo}
        <input name="ticketNo" required placeholder="MT-10001" dir="ltr" autoCapitalize="characters" className={input} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">{t.mobile}
        <input name="mobile" type="tel" required inputMode="tel" placeholder="01xxxxxxxxx" maxLength={16} dir="ltr" className={`${input} tracking-wider`} />
      </label>
      {state.error && <p role="alert" className="text-sm text-red-800">{t.errors[state.error] ?? t.errors.failed}</p>}
      <button disabled={pending} aria-busy={pending} className="rounded-lg bg-[var(--accent)] text-[var(--on-accent)] py-3 font-semibold hover:brightness-95 disabled:opacity-60">{t.find}</button>
    </form>
  );
}
