"use client";

import { useActionState } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { signIn, type LoginState } from "./actions";

export function LoginForm({ locale }: { locale: Locale }) {
  const t = dictionaries[locale].login;
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        {t.email}
        <input name="email" type="email" autoComplete="username" required dir="ltr"
          className="rounded-lg border border-stone-300 px-3 py-2.5 font-normal focus:outline-2 focus:outline-stone-900" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        {t.password}
        <input name="password" type="password" autoComplete="current-password" required dir="ltr"
          className="rounded-lg border border-stone-300 px-3 py-2.5 font-normal focus:outline-2 focus:outline-stone-900" />
      </label>
      {state.error && <p role="alert" className="text-sm text-red-800">{state.error}</p>}
      <button disabled={pending} aria-busy={pending} className="rounded-lg bg-[var(--accent)] text-[var(--on-accent)] py-3 font-semibold hover:brightness-95 disabled:opacity-60">
        {pending ? t.pending : t.submit}
      </button>
    </form>
  );
}
