import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { getLessonTranslation } from "@/db/queries/admin/translations";
import { requireAdminPermission } from "@/lib/admin/guard";
import { hasPermission } from "@/lib/authz";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { translationTargetLocale } from "@/lib/translations/target-locale";
import {
  TRANSLATION_STATES,
  type TranslationState,
} from "@/lib/translations/state";
import { TranslationForm } from "./features/translation-form";

export const dynamic = "force-dynamic";

/**
 * Translating a lesson.
 *
 * Its own route, following the body editor's precedent: naming and publishing
 * a lesson, writing it, and translating it are three different jobs at three
 * different moments, and one page holding all of them is a page where nobody
 * is sure what a save saved.
 */
export default async function TranslateLessonPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale as Locale);

  // `translation:read` to open it. Writing needs more, and the buttons for
  // that are rendered from the checks below rather than shown and refused.
  const actor = await requireAdminPermission("translation:read");

  const target = translationTargetLocale();
  if (!target) notFound();

  const view = await getLessonTranslation(slug, target);
  if (!view) notFound();

  const t = await getTranslations("admin.translations");
  const tLessons = await getTranslations("admin.lessons");

  const states = Object.fromEntries(
    TRANSLATION_STATES.map((state) => [state, t(state)]),
  ) as Record<TranslationState, string>;

  const status: TranslationState = !view.translation
    ? "missing"
    : view.translation.status === "published"
      ? view.translation.stale
        ? "stale"
        : "published"
      : view.translation.status;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Button variant="ghost" size="sm" asChild className="-ms-2">
          <Link href={`/admin/lessons/${view.slug}`}>{t("back")}</Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">
          {tLessons("editTitle", { title: view.source.title })}
        </h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <TranslationForm
        slug={view.slug}
        locale={view.locale}
        source={view.source}
        translation={
          view.translation
            ? {
                title: view.translation.title,
                description: view.translation.description,
                status,
              }
            : null
        }
        sections={view.sections.map((section) => ({
          id: section.id,
          position: section.position,
          heading: section.heading,
          blocks: section.blocks,
          values: section.values,
          translatedHeading: section.translatedHeading,
        }))}
        can={{
          write: hasPermission(actor, "translation:write"),
          review: hasPermission(actor, "translation:review"),
        }}
        labels={{
          title: t("title"),
          description: t("description"),
          sectionHeading: t("sectionHeading"),
          source: t("source"),
          save: t("save"),
          saved: t("saved"),
          submit: t("submit"),
          publish: t("publish"),
          sendBack: t("sendBack"),
          // Interpolated in the component rather than here: the counts are
          // client state, and a formatting function cannot cross the
          // server/client boundary.
          progress: t.raw("progress") as string,
          optional: t("optional"),
          states,
          fieldKinds: {
            text: t("kinds.text"),
            alt: t("kinds.alt"),
            caption: t("kinds.caption"),
            attribution: t("kinds.attribution"),
            item: t("kinds.item"),
          },
        }}
      />
    </div>
  );
}
