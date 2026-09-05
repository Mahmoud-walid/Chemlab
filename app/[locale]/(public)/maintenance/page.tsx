import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { pageStateFor } from "@/db/queries/pages";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

/**
 * What a visitor sees instead of a closed page.
 *
 * Reached only by a rewrite from the proxy, so the URL in the address bar is
 * still the page they asked for — a reload lands on the real page the moment
 * it reopens.
 *
 * The operator's message is looked up from the route they actually requested,
 * read from the `x-pathname` header the proxy forwards. Without that this page
 * could only ever show one message for every closed route.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.maintenance" });
  return {
    title: t("metaTitle"),
    // A closed page is temporary. Letting it be indexed would replace the real
    // page in search results with an apology.
    robots: { index: false, follow: false },
  };
}

export default async function MaintenancePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  const t = await getTranslations("pages.maintenance");

  const requested = (await headers()).get("x-pathname") ?? "/";
  const state = await pageStateFor(requested);
  const custom = state?.maintenanceMessage?.[locale];

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-bold tracking-tight">{t("heading")}</h1>
      <p className="text-muted-foreground">
        {custom && custom.trim() !== "" ? custom : t("default")}
      </p>
      <Button asChild>
        <Link href="/">{t("backHome")}</Link>
      </Button>
    </main>
  );
}
