import { requireSession } from "@/lib/auth";
import { Brand } from "@/components/brand";
import { LangToggle } from "@/app/lang-toggle";
import { ThemeSwitch } from "@/app/theme-switch";
import { getI18n } from "@/lib/i18n";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Pandora Maintenance" };

export default async function ChangePasswordPage() {
  await requireSession();
  const { t, locale } = await getI18n();
  return (
    <main className="min-h-screen flex items-center justify-center bg-stone-100 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-stone-200 p-6 shadow-sm">
        <ThemeSwitch fixed />
        <div className="flex justify-end mb-2"><LangToggle label={t.switchTo} className="border-stone-200 bg-white hover:bg-stone-50" /></div>
        <div className="text-center mb-4"><Brand /></div>
        <h1 className="text-lg font-semibold">{t.pwd.title}</h1>
        <p className="text-sm text-stone-600 mt-1 mb-4">{t.pwd.note}</p>
        <PasswordForm locale={locale} />
      </div>
    </main>
  );
}
