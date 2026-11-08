import { withBase } from "@/lib/base";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { navFor } from "@/lib/nav";
import { SignOutButton } from "@/app/sign-out-button";
import { LangToggle } from "@/app/lang-toggle";
import { ThemeSwitch } from "@/app/theme-switch";
import { Brand } from "@/components/brand";
import { NavLinks } from "@/components/nav-links";
import { PageTitle } from "@/components/page-title";
import { ViewAs } from "./view-as";
import { Toaster } from "@/components/toast";
import { createClient } from "@/lib/supabase/server";
import { loadWorkflow } from "@/lib/workflow";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (session.mustChangePassword) redirect("/change-password");
  const { t, locale } = await getI18n();
  const supabase = await createClient();
  // Menu names renamed in Admin → Menu override the built-in ones
  const [{ data: menu }, wf] = await Promise.all([
    supabase.from("app_settings").select("value").eq("key", "menu_labels").maybeSingle(),
    loadWorkflow(supabase),
  ]);
  const custom = (menu?.value ?? {}) as Record<string, { ar?: string; en?: string }>;
  const navLabels: Record<string, string> = { ...t.nav };
  for (const [href, v] of Object.entries(custom)) { const name = v?.[locale === "ar" ? "ar" : "en"]; if (name) navLabels[href] = name; }
  // Store roles see Quote approval only when the Customer Service step is off
  // …and then only while one of their tickets is waiting on the customer's answer (or was rejected)
  const storeQuotes = !session.fullAccess && session.role !== "cs";
  const { count: quoteCount } = storeQuotes && !wf.cs_quote
    ? await supabase.from("tickets").select("id", { count: "exact", head: true }).in("status", ["awaiting_customer_approval", "quote_rejected"])
    : { count: 0 };
  const nav = navFor(session.role, session.fullAccess)
    .filter((n) => !(n.href === "/quotes" && storeQuotes && (wf.cs_quote || !quoteCount)));
  const scope = session.branches.length ? session.branches.map((b) => b.name).join(", ") : t.shell.allBranches;
  const initials = session.fullName.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="min-h-screen text-stone-900">
      {session.training && (
        <div role="status" className="no-print bg-amber-400 text-amber-950 text-center text-sm font-bold py-2 px-4">{t.shell.training}</div>
      )}
      <div className="no-print mx-auto max-w-7xl px-4 sm:px-6 pt-4">
        <header className="hdr relative overflow-hidden rounded-[22px] px-5 sm:px-7 py-5 flex flex-wrap items-center gap-4 sm:gap-5">
          {/* Decorative rings, as on the Dashboards header */}
          <span aria-hidden className="absolute -top-16 end-40 w-52 h-52 rounded-full border-[22px] border-white/20 pointer-events-none" />
          <span aria-hidden className="absolute -bottom-20 start-[38%] w-32 h-32 rounded-full border-[14px] border-white/15 pointer-events-none" />

          <span className="hdr-pop relative w-16 h-16 shrink-0 rounded-full bg-white grid place-items-center shadow-[0_6px_20px_-8px_rgb(42_16_24/.35)]">
            <Brand mark />
          </span>
          <span aria-hidden className="hidden sm:block self-stretch w-px bg-[#2A1018]/15" />
          <div className="relative min-w-0 flex-1">
            <span className="eyebrow">{t.appFull}</span>
            <PageTitle titles={navLabels} fallback={t.appFull} />
            <p className="hdr-pop text-sm text-[#2A1018]/75 mt-0.5 truncate">
              {session.fullName} · {session.viewingAs ? t.shell.viewingAs(t.roles[session.role]) : t.roles[session.role]} · {session.fullAccess || session.isAdmin ? t.shell.fullAccess : scope}
            </p>
          </div>
          <form action={withBase("/go")} role="search" className="relative order-last w-full md:order-none md:w-auto">
            <input name="s" placeholder={t.shell.search} aria-label={t.shell.search}
              className="w-full md:w-64 rounded-full border border-white/70 bg-white/80 px-4 py-2 text-sm text-[#2A1018] placeholder:text-[#2A1018]/55 focus:outline-2 focus:outline-[#2A1018]" />
          </form>
          <div className="relative flex items-center gap-2.5">
            <span aria-hidden className="hidden md:grid w-10 h-10 rounded-full bg-white/70 text-[#2A1018] place-items-center text-xs font-extrabold">{initials}</span>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- the dashboards home lives outside this app's /maintenance path */}
            {session.isAdmin && <a href="/" className="hdr-btn">{t.shell.home}</a>}
            {session.isAdmin && <ViewAs current={session.viewingAs ?? "admin"} label={t.shell.viewAs} roles={t.roles} />}
            <ThemeSwitch />
            <LangToggle label={t.switchTo} className="hdr-btn" />
            <SignOutButton label={t.shell.signOut} />
          </div>
        </header>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 flex flex-wrap gap-6">
        <nav aria-label="Main" className="no-print w-full sm:w-auto sm:flex-[1_1_200px] sm:max-w-60 flex sm:flex-col gap-2 overflow-x-auto sm:overflow-visible -mx-1 px-1 pb-1 sm:m-0 sm:p-0 sm:sticky sm:top-4 self-start">
          <NavLinks items={nav.map((n) => ({ href: n.href, label: navLabels[n.href], ready: n.ready, soon: t.shell.soon }))} />
        </nav>
        <main className="app-main flex-[999_1_560px] min-w-0">{children}</main>
      </div>
      <Toaster fallback={t.shell.done} />
    </div>
  );
}
