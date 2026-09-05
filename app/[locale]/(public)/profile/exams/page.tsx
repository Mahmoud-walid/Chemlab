import { getTranslations, setRequestLocale } from "next-intl/server";

import { requireUser } from "@/lib/session";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/**
 * An authenticated route with a deliberate empty state.
 *
 * This issue owns the menu entry, the route and its protection; the content
 * arrives with the feature that produces it (the exam engine). An empty page
 * that says so is more honest than a menu entry that 404s.
 */
export default async function ProfileExamsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  await requireUser();
  const t = await getTranslations("auth");

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight">{t("examsTitle")}</h1>
      <p className="text-muted-foreground">{t("examsEmpty")}</p>
      <p className="text-sm text-muted-foreground">{t("examsComingSoon")}</p>
      <Button asChild variant="outline">
        <Link href="/quiz">{t("browseQuizzes")}</Link>
      </Button>
    </div>
  );
}
