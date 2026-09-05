import { notFound } from "next/navigation";
import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";

import { getLessonForAdmin } from "@/db/queries/admin/lessons";
import { requireAdminPermission } from "@/lib/admin/guard";
import { publishBlockers } from "@/lib/admin/lesson-schema";
import { hasPermission } from "@/lib/authz";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { LessonForm } from "../features/lesson-form";
import { LessonLifecycle } from "../features/lesson-lifecycle";

export const dynamic = "force-dynamic";

export default async function AdminLessonPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale as Locale);

  // Editing needs more than reading, and the check is here rather than left to
  // the action alone: the form should not render for someone who cannot save.
  const actor = await requireAdminPermission("lesson:update");

  const lesson = await getLessonForAdmin(slug);
  if (!lesson) notFound();

  const t = await getTranslations("admin.lessons");
  const format = await getFormatter();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Button variant="ghost" size="sm" asChild className="-ms-2">
          <Link href="/admin/lessons">{t("backToList")}</Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("editTitle", { title: lesson.title })}
        </h1>
        <p className="text-sm text-muted-foreground">{t("editSubtitle")}</p>
      </div>

      <LessonLifecycle
        id={lesson.id}
        slug={lesson.slug}
        status={lesson.status}
        isDeleted={lesson.deletedAt !== null}
        publishedOnLabel={
          lesson.publishedAt
            ? format.dateTime(lesson.publishedAt, { dateStyle: "long" })
            : null
        }
        // Computed here, from the stored row. The action recomputes it before
        // it writes anything — this copy only decides what the button looks
        // like.
        blockers={publishBlockers({
          title: lesson.title,
          description: lesson.description,
          category: lesson.category,
          sectionCount: lesson.sectionCount,
          deletedAt: lesson.deletedAt,
        })}
        can={{
          publish: hasPermission(actor, "lesson:publish"),
          delete: hasPermission(actor, "lesson:delete"),
        }}
      />

      {/* The body, read-only. #16 leaves the rich editor to its own issue, and
          a second editor here would be a second thing to keep correct. */}
      <section
        aria-labelledby="body-heading"
        className="space-y-2 rounded-lg border p-4"
      >
        <h2 id="body-heading" className="font-semibold">
          {t("body.heading")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {lesson.sectionCount === 0
            ? t("body.empty")
            : t("body.count", { count: lesson.sectionCount })}
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled
          aria-describedby="body-why"
        >
          {t("body.editDisabled")}
        </Button>
        <p id="body-why" className="text-xs text-muted-foreground">
          {t("body.editDisabledReason")}
        </p>
      </section>

      <LessonForm
        values={{
          id: lesson.id,
          slug: lesson.slug,
          title: lesson.title,
          description: lesson.description,
          difficulty: lesson.difficulty,
          category: lesson.category,
          coverImageUrl: lesson.coverImageUrl,
          references: lesson.references,
          tags: lesson.tags,
          position: lesson.position,
          isPublished: lesson.status === "published",
        }}
      />
    </div>
  );
}
