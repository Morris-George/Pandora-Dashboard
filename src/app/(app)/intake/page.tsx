import { requireRole } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { IntakeForm } from "./intake-form";

export const metadata = { title: "Pandora Maintenance" };

export default async function IntakePage() {
  const session = await requireRole("associate", "manager");
  const { t, locale } = await getI18n();
  const supabase = await createClient();
  const { data: categories } = await supabase
    .from("fault_categories")
    .select("name, name_ar, requires_comment, cost")
    .eq("active", true)
    .order("sort_order");

  if (!session.branches.length) {
    return (
      <section className="bg-white rounded-2xl border border-stone-200 p-8">
        <h1 className="text-xl font-semibold mb-2">{t.intake.noBranchTitle}</h1>
        <p className="text-stone-600">{t.intake.noBranch}</p>
      </section>
    );
  }

  return (
    <IntakeForm
      locale={locale}
      branches={session.branches}
      categories={(categories ?? []).map((c) => ({
        name: c.name,
        label: locale === "ar" && c.name_ar ? c.name_ar : c.name,
        requiresComment: c.requires_comment,
        cost: c.cost === null ? null : Math.round(Number(c.cost) * 1.14 * 100) / 100, // incl. VAT
      }))}
    />
  );
}
