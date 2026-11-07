import { getI18n } from "@/lib/i18n";
import { LangToggle } from "@/app/lang-toggle";
import { Brand } from "@/components/brand";
import { LoginForm } from "./login-form";

export const metadata = { title: "Pandora Maintenance" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { t, locale } = await getI18n();
  return (
    <main className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden">
      {/* Soft backdrop */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(60rem_40rem_at_20%_-10%,#efe3e4,transparent),radial-gradient(50rem_30rem_at_110%_110%,#ece9e4,transparent)]" />
      <div className="w-full max-w-sm">
        <div className="flex justify-end mb-6 rise">
          <LangToggle label={t.switchTo} className="border-stone-200 bg-white/80 hover:bg-white" />
        </div>
        <div className="text-center mb-8 rise" style={{ animationDelay: ".05s" }}>
          <Brand size="lg" />
          <div className="text-sm text-stone-500 mt-3 tracking-wide">{t.appFull}</div>
        </div>
        <div className="rise bg-white/90 backdrop-blur rounded-2xl border border-stone-200 p-7 shadow-[0_20px_60px_-30px_rgb(28_25_23/.35)]" style={{ animationDelay: ".1s" }}>
          <h1 className="text-lg font-semibold mb-5">{t.login.title}</h1>
          {error === "inactive" && (
            <p role="alert" className="mb-4 text-sm text-red-800 bg-red-50 rounded-lg p-3">{t.login.inactive}</p>
          )}
          <LoginForm locale={locale} />
        </div>
        <p className="text-xs text-stone-500 text-center mt-6 rise" style={{ animationDelay: ".15s" }}>{t.login.help}</p>
      </div>
    </main>
  );
}
