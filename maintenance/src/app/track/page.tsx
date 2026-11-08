import { getI18n } from "@/lib/i18n";
import { LangToggle } from "@/app/lang-toggle";
import { ThemeSwitch } from "@/app/theme-switch";
import { Brand } from "@/components/brand";
import { LookupForm } from "./lookup-form";

export const metadata = { title: "Pandora — Track your repair" };

export default async function TrackLookupPage() {
  const { t, locale } = await getI18n();
  return (
    <main className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden">
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(60rem_40rem_at_20%_-10%,#efe3e4,transparent),radial-gradient(50rem_30rem_at_110%_110%,#ece9e4,transparent)]" />
      <div className="w-full max-w-sm">
        <ThemeSwitch fixed />
        <div className="flex justify-end mb-6 rise"><LangToggle label={t.switchTo} className="border-stone-200 bg-white/80 hover:bg-white" /></div>
        <div className="text-center mb-8 rise"><Brand size="lg" /><div className="text-sm text-stone-500 mt-3">{t.track.subtitle}</div></div>
        <div className="rise bg-white/90 backdrop-blur rounded-2xl border border-stone-200 p-7 shadow-[0_20px_60px_-30px_rgb(28_25_23/.35)]">
          <h1 className="text-lg font-semibold">{t.track.lookupTitle}</h1>
          <p className="text-sm text-stone-600 mt-1 mb-5">{t.track.lookupNote}</p>
          <LookupForm locale={locale} />
        </div>
      </div>
    </main>
  );
}
