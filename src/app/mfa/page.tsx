import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { getI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { MfaForm } from "./mfa-form";

export const metadata = { title: "Pandora Maintenance" };

// Two-step login for Super Admins: set up an authenticator app once, then enter its code at each sign-in
export default async function MfaPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");
  if (data.claims.aal === "aal2") redirect("/");
  const { t, locale } = await getI18n();
  return (
    <main className="min-h-screen flex items-center justify-center bg-stone-100 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-stone-200 p-6 shadow-sm">
        <div className="text-center mb-4"><Brand /></div>
        <h1 className="text-lg font-semibold">{t.mfa.title}</h1>
        <MfaForm locale={locale} />
      </div>
    </main>
  );
}
