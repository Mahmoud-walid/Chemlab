import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { getElementByNumber } from "@/db/queries/admin/elements";
import { requireAdminPermission } from "@/lib/admin/guard";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { ElementForm } from "../features/element-form";

export const dynamic = "force-dynamic";

export default async function AdminElementPage({
  params,
}: {
  params: Promise<{ locale: string; number: string }>;
}) {
  const { locale, number } = await params;
  setRequestLocale(locale as Locale);

  // Editing needs more than reading, and the check is here rather than left to
  // the action alone: the form should not render for someone who cannot save.
  await requireAdminPermission("element:update");

  const atomicNumber = Number(number);
  if (!Number.isInteger(atomicNumber) || atomicNumber < 1) notFound();

  const element = await getElementByNumber(atomicNumber);
  if (!element) notFound();

  const t = await getTranslations("admin.elements");

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Button variant="ghost" size="sm" asChild className="-ms-2">
          <Link href="/admin/elements">{t("backToList")}</Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("editTitle", { name: element.name })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("editSubtitle", { number: element.number })}
        </p>
      </div>

      <ElementForm
        values={{
          number: element.number,
          symbol: element.symbol,
          name: element.name,
          category: element.category,
          phase: element.phase,
          atomicMass: element.atomicMass,
          period: element.period,
          xpos: element.xpos,
          ypos: element.ypos,
          density: element.density,
          melt: element.melt,
          boil: element.boil,
          molarHeat: element.molarHeat,
          electronAffinity: element.electronAffinity,
          electronegativityPauling: element.electronegativityPauling,
          electronConfiguration: element.electronConfiguration,
          electronConfigurationSemantic: element.electronConfigurationSemantic,
          shells: element.shells,
          ionizationEnergies: element.ionizationEnergies,
          summary: element.summary,
          source: element.source,
          appearance: element.appearance,
          color: element.color,
          spectralImg: element.spectralImg,
          discoveredBy: element.discoveredBy,
          namedBy: element.namedBy,
        }}
      />
    </div>
  );
}
