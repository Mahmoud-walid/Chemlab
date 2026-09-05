import { getTranslations, setRequestLocale } from "next-intl/server";

import { nextLessonPosition } from "@/db/queries/admin/lessons";
import { requireAdminPermission } from "@/lib/admin/guard";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { LessonForm } from "../features/lesson-form";

export const dynamic = "force-dynamic";

export default async function NewLessonPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  await requireAdminPermission("lesson:create");

  const t = await getTranslations("admin.lessons");
  const position = await nextLessonPosition();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Button variant="ghost" size="sm" asChild className="-ms-2">
          <Link href="/admin/lessons">{t("backToList")}</Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">{t("newTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("newSubtitle")}</p>
      </div>

      <LessonForm
        values={{
          slug: "",
          title: "",
          description: "",
          difficulty: "easy",
          category: "",
          coverImageUrl: null,
          references: [],
          tags: [],
          // At the end of the sequence, so creating a lesson never silently
          // reorders the catalogue.
          position,
          isPublished: false,
        }}
      />
    </div>
  );
}
