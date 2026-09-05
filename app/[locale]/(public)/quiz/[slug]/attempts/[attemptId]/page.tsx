import { notFound } from "next/navigation";
import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";
import { CheckCircle2, XCircle } from "lucide-react";

import { getReview } from "@/db/queries/exams/attempts";
import { gradeKey } from "@/lib/exams/score";
import { requireUser } from "@/lib/session";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * The answers, after the fact.
 *
 * Every refusal is decided by `getReview`, not here: the attempt must belong
 * to this person, be finished, and be allowed by the quiz's `reviewPolicy`.
 * Putting the checks in the page would mean the next page that renders a
 * review has to remember all three.
 */
export default async function AttemptReviewPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string; attemptId: string }>;
}) {
  const { locale, slug, attemptId } = await params;
  setRequestLocale(locale as Locale);

  const user = await requireUser();
  const result = await getReview(attemptId, user.id, locale);

  const t = await getTranslations("quiz");
  const format = await getFormatter();

  if (!result.ok) {
    // A policy refusal is not a 404 — the attempt exists and is the
    // candidate's own, and telling them "no such page" would be a lie they
    // could disprove from their own history.
    if (result.reason === "policy") {
      return (
        <div className="mx-auto w-full max-w-xl space-y-4 px-4 py-10">
          <h1 className="text-xl font-bold">{t("reviewUnavailable")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("reviewUnavailableReason")}
          </p>
          <Button asChild variant="outline">
            <Link href={`/quiz/${slug}`}>{t("backToQuiz")}</Link>
          </Button>
        </div>
      );
    }
    notFound();
  }

  const { review } = result;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 px-4 py-10">
      <div className="space-y-3 rounded-2xl border border-border bg-card p-6 text-center">
        <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
          {t("result")}
        </p>
        <p className="text-5xl font-bold text-foreground">
          {format.number(review.percent / 100, { style: "percent" })}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("correctOf", { score: review.score, total: review.maxScore })}
        </p>
        <Progress
          value={review.percent}
          aria-label={t("scoreProgress", { percent: review.percent })}
          className="h-2"
        />
        <p className="text-sm font-medium">
          {/* A message key, not an English string from a lib module — the old
              `gradeLabel()` returned "Excellent!" straight into an Arabic page. */}
          {t(`grade.${gradeKey(review.percent)}` as never)}
        </p>
        {review.status === "expired" && (
          <p className="text-xs text-muted-foreground">{t("markedAtTimeUp")}</p>
        )}
      </div>

      <ol className="space-y-3">
        {review.questions.map((question) => (
          <li
            key={question.id}
            className={cn(
              "space-y-2 rounded-xl border p-4",
              question.isCorrect
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-destructive/30 bg-destructive/5",
            )}
          >
            <div className="flex items-start gap-2">
              {question.isCorrect ? (
                <CheckCircle2
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-emerald-500"
                />
              ) : (
                <XCircle
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-destructive"
                />
              )}
              <div className="space-y-0.5">
                {/* The state in text as well as in colour: a red border is not
                    a fact a screen reader can read, and colour alone fails
                    every contrast-independent reading of the same page. */}
                <p className="sr-only">
                  {question.isCorrect
                    ? t("markedCorrect")
                    : question.answered
                      ? t("markedIncorrect")
                      : t("markedUnanswered")}
                </p>
                <p className="font-medium leading-snug text-foreground">
                  {question.prompt}
                </p>
              </div>
            </div>

            <ul className="space-y-1 ps-6 text-sm">
              {question.options.map((option) => (
                <li
                  key={option.id}
                  className={cn(
                    "flex items-center gap-2",
                    option.isCorrect
                      ? "font-medium text-emerald-700 dark:text-emerald-400"
                      : option.chosen
                        ? "text-destructive"
                        : "text-muted-foreground",
                  )}
                >
                  <span>{option.label}</span>
                  {option.isCorrect && (
                    <span className="text-xs">{t("correctAnswerTag")}</span>
                  )}
                  {option.chosen && !option.isCorrect && (
                    <span className="text-xs">{t("yourAnswerTag")}</span>
                  )}
                </li>
              ))}
            </ul>

            {!question.answered && (
              <p className="ps-6 text-xs text-muted-foreground">
                {t("markedUnanswered")}
              </p>
            )}

            {question.explanation && (
              <p className="ps-6 text-xs italic text-muted-foreground">
                <span className="font-medium not-italic">
                  {t("explanation")}{" "}
                </span>
                {question.explanation}
              </p>
            )}
          </li>
        ))}
      </ol>

      <div className="flex gap-2">
        <Button asChild variant="outline" className="flex-1">
          <Link href={`/quiz/${slug}`}>{t("backToQuiz")}</Link>
        </Button>
        <Button asChild className="flex-1">
          <Link href="/profile/exams">{t("seeAllResults")}</Link>
        </Button>
      </div>
    </div>
  );
}
