"use client";

import { useActionState } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { changePassword, type PwdState } from "./actions";

const input = "rounded-lg border border-stone-300 px-3 py-2.5 font-normal focus:outline-2 focus:outline-stone-900";

export function PasswordForm({ locale }: { locale: Locale }) {
  const t = dictionaries[locale].pwd;
  const [state, action, pending] = useActionState<PwdState, FormData>(changePassword, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm font-medium">{t.new}
        <input name="password" type="password" autoComplete="new-password" minLength={10} required dir="ltr" className={input} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">{t.confirm}
        <input name="confirm" type="password" autoComplete="new-password" minLength={10} required dir="ltr" className={input} />
      </label>
      <p className="text-xs text-stone-500">{t.rule}</p>
      {state.error && <p role="alert" className="text-sm text-red-800">{state.error}</p>}
      <button disabled={pending} className="rounded-lg bg-[var(--accent)] text-[var(--on-accent)] py-3 font-semibold disabled:opacity-50">{t.save}</button>
    </form>
  );
}
