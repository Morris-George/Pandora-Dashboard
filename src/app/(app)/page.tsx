import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { navFor } from "@/lib/nav";

export default async function Home({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const session = await requireSession();
  const { t } = await getI18n();
  const { denied } = await searchParams;
  const first = navFor(session.role).find((n) => n.ready);
  if (first && !denied) redirect(first.href);
  const role = t.roles[session.role];

  return (
    <section className="bg-white rounded-2xl border border-stone-200 p-8">
      <h1 className="text-xl font-semibold mb-2">{denied ? t.home.deniedTitle : t.home.welcome(session.fullName)}</h1>
      <p className="text-stone-600">{denied ? t.home.denied(role) : t.home.building(role)}</p>
    </section>
  );
}
