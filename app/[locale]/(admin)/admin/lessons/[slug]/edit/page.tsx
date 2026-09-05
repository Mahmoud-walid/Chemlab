import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import {
  editableLessonId,
  getEditableSections,
} from "@/db/queries/admin/lesson-sections";
import { getLessonForAdmin } from "@/db/queries/admin/lessons";
import { requireAdminPermission } from "@/lib/admin/guard";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { BodyEditor } from "./features/body-editor";

export const dynamic = "force-dynamic";

/**
 * Writing a lesson.
 *
 * A separate route from the lesson's settings form, deliberately. They are
 * different jobs at different moments — naming and publishing a lesson versus
 * writing it — and one page holding both means an autosaving body next to a
 * submit-button form, where it is never clear which changes are already saved.
 */
export default async function EditLessonBodyPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale as Locale);

  // The same permission the save action requires. Rendering an editor for
  // somebody whose every save would be refused is a worse experience than not
  // showing it.
  await requireAdminPermission("lesson:update");

  const lessonId = await editableLessonId(slug);
  if (!lessonId) notFound();

  const [lesson, sections] = await Promise.all([
    getLessonForAdmin(slug),
    getEditableSections(lessonId),
  ]);
  if (!lesson) notFound();

  const t = await getTranslations("admin.lessons.body");

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Button variant="ghost" size="sm" asChild className="-ms-2">
          <Link href={`/admin/lessons/${slug}`}>{t("backToLesson")}</Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("title", { title: lesson.title })}
        </h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <BodyEditor
        slug={slug}
        initial={sections.map((section) => ({
          id: section.id,
          heading: section.heading,
          blocks: section.blocks,
        }))}
        labels={{
          heading: t("sectionHeading"),
          headingPlaceholder: t("headingPlaceholder"),
          bodyPlaceholder: t("bodyPlaceholder"),
          bodyLabel: t("bodyLabel"),
          addSection: t("addSection"),
          removeSection: t("removeSection"),
          preview: t("preview"),
          readingTime: t("readingTime"),
          empty: t("empty"),
          save: {
            idle: t("save.idle"),
            dirty: t("save.dirty"),
            saving: t("save.saving"),
            saved: t("save.saved"),
            failed: t("save.failed"),
          },
        }}
      />
    </div>
  );
}
