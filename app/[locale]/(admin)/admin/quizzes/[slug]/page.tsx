import { notFound } from "next/navigation";
import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";

import { getQuizForAdmin, quizPublishCounts } from "@/db/queries/admin/quizzes";
import { requireAdminPermission } from "@/lib/admin/guard";
import {
  minutesFromSeconds,
  quizPublishBlockers,
} from "@/lib/admin/quiz-schema";
import { hasPermission } from "@/lib/authz";
import { translationTargetLocale } from "@/lib/translations/target-locale";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { QuestionEditor } from "../features/question-editor";
import { QuizForm } from "../features/quiz-form";
import { QuizLifecycle } from "../features/quiz-lifecycle";

export const dynamic = "force-dynamic";

export default async function AdminQuizPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale as Locale);

  // Editing needs more than reading, and the check is here rather than left to
  // the actions alone: the form should not render for someone who cannot save.
  const actor = await requireAdminPermission("quiz:update");

  const quiz = await getQuizForAdmin(slug);
  if (!quiz) notFound();

  const counts = await quizPublishCounts(quiz.id);

  const t = await getTranslations("admin.quizzes");
  const tTranslations = await getTranslations("admin.translations");
  const format = await getFormatter();

  // Only when a second locale exists AND this actor may work on it. A link to
  // a page that would 404 is worse than no link.
  const canTranslate =
    translationTargetLocale() !== null &&
    hasPermission(actor, "translation:read");

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Button variant="ghost" size="sm" asChild className="-ms-2">
          <Link href="/admin/quizzes">{t("backToList")}</Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("editTitle", { title: quiz.title })}
        </h1>
        <p className="text-sm text-muted-foreground">{t("editSubtitle")}</p>
        {/* Beside the quiz's own heading rather than on the settings form: a
            translator's job starts from the words, and the words are the
            questions below. */}
        {canTranslate && (
          <Button variant="outline" size="sm" asChild className="mt-2">
            <Link href={`/admin/quizzes/${quiz.slug}/translate`}>
              {tTranslations("open")}
            </Link>
          </Button>
        )}
      </div>

      <QuizLifecycle
        id={quiz.id}
        slug={quiz.slug}
        status={quiz.status}
        isDeleted={quiz.deletedAt !== null}
        publishedOnLabel={
          quiz.publishedAt
            ? format.dateTime(quiz.publishedAt, { dateStyle: "long" })
            : null
        }
        // Computed here, from the stored rows. The action recomputes it before
        // it writes anything — this copy only decides what the button looks
        // like.
        blockers={quizPublishBlockers({ ...quiz, ...counts })}
        can={{
          publish: hasPermission(actor, "quiz:publish"),
          delete: hasPermission(actor, "quiz:delete"),
        }}
      />

      <QuizForm
        values={{
          id: quiz.id,
          slug: quiz.slug,
          title: quiz.title,
          description: quiz.description,
          difficulty: quiz.difficulty,
          category: quiz.category,
          position: quiz.position,
          timeLimitMinutes: minutesFromSeconds(quiz.timeLimitSeconds),
          passMarkPercent: quiz.passMarkPercent,
          maxAttempts: quiz.maxAttempts,
          shuffleQuestions: quiz.shuffleQuestions,
          shuffleOptions: quiz.shuffleOptions,
          isPublished: quiz.status === "published",
        }}
      />

      <QuestionEditor
        quizId={quiz.id}
        canEdit
        initial={quiz.questions.map((question) => ({
          id: question.id,
          prompt: question.prompt,
          explanation: question.explanation,
          points: question.points,
          // The stored id doubles as the client-side key for a question that
          // already exists; only newly added ones need a generated one.
          key: question.id,
          options: question.options.map((option) => ({
            id: option.id,
            label: option.label,
            key: option.id,
          })),
          correctIndex: question.correctIndex,
        }))}
      />
    </div>
  );
}
