import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { getQuizTranslation } from "@/db/queries/admin/quiz-translations";
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
import { QuizTranslationForm } from "./features/quiz-translation-form";

export const dynamic = "force-dynamic";

/**
 * Translating a quiz.
 *
 * Its own route, following the lesson editor's precedent: naming and
 * publishing a quiz, writing its questions, and translating it are three
 * different jobs at three different moments.
 */
export default async function TranslateQuizPage({
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

  const view = await getQuizTranslation(slug, target);
  if (!view) notFound();

  const t = await getTranslations("admin.translations");
  const tQuiz = await getTranslations("admin.quizzes");

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
          <Link href={`/admin/quizzes/${view.slug}`}>{t("quiz.back")}</Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">
          {tQuiz("editTitle", { title: view.source.title })}
        </h1>
        <p className="text-sm text-muted-foreground">{t("quiz.subtitle")}</p>
      </div>

      <QuizTranslationForm
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
        questions={view.questions.map((question) => ({
          id: question.id,
          position: question.position,
          prompt: question.prompt,
          explanation: question.explanation,
          translatedPrompt: question.translatedPrompt,
          translatedExplanation: question.translatedExplanation,
          options: question.options.map((option) => ({
            id: option.id,
            position: option.position,
            label: option.label,
            translatedLabel: option.translatedLabel,
          })),
        }))}
        can={{
          write: hasPermission(actor, "translation:write"),
          review: hasPermission(actor, "translation:review"),
        }}
        labels={{
          title: t("title"),
          description: t("description"),
          questionHeading: t.raw("quiz.questionHeading") as string,
          prompt: t("quiz.prompt"),
          explanation: t("quiz.explanation"),
          options: t("quiz.option"),
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
          incompleteTitle: t("quiz.incompleteTitle"),
          incompleteBody: t("quiz.incompleteBody"),
          incompleteQuestion: t.raw("quiz.incompleteQuestion") as string,
          partNames: {
            prompt: t("quiz.parts.prompt"),
            explanation: t("quiz.parts.explanation"),
            options: t("quiz.parts.options"),
          },
          partSeparator: t("quiz.partSeparator"),
          states,
        }}
      />
    </div>
  );
}
