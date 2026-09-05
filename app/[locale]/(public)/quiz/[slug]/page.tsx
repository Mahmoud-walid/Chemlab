import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";

import { getQuizIntro, listAttempts } from "@/db/queries/exams/attempts";
import { getCurrentUser } from "@/lib/session";
import { Link, redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StartButton } from "./features/start-button";

/**
 * The intro to a sitting.
 *
 * Dynamic, and it has to be: it shows this person's attempt history, whether
 * they have a sitting open, and how many attempts they have left. There is no
 * `generateStaticParams` any more for the same reason — a prerendered copy of
 * this page would be somebody else's history. The catalogue at `/quiz` and the
 * sitemap still enumerate every quiz, so nothing is lost to discovery.
 */
export const dynamic = "force-dynamic";

const DIFFICULTY_STYLES: Record<string, string> = {
  easy: "bg-chart-5/20 text-chart-5-on-tint border-chart-5/40",
  medium: "bg-chart-4/20 text-chart-4-on-tint border-chart-4/40",
  hard: "bg-destructive/15 text-destructive-on-tint border-destructive/30",
};

export default async function QuizSlugPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale as Locale);

  const quiz = await getQuizIntro(slug, locale);
  if (!quiz) {
    redirect({ href: "/quiz", locale: locale as Locale });
    // Unreachable — redirect() throws. Present only because next-intl types it
    // as returning void rather than never, so TypeScript cannot narrow `quiz`.
    return null;
  }

  const t = await getTranslations("quiz");
  const format = await getFormatter();

  // Anonymous visitors see the whole intro and are asked to sign in — rather
  // than being redirected, which would lose the page they were reading.
  const user = await getCurrentUser();
  const attempts = user ? await listAttempts(slug, user.id) : [];
  const live = attempts.find((attempt) => attempt.status === "in_progress");
  const used = attempts.length;
  const exhausted =
    quiz.maxAttempts !== null && used >= quiz.maxAttempts && !live;

  return (
    <div className="mx-auto w-full max-w-xl space-y-5 px-4 py-10">
      <Link
        href="/quiz"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        {t("backToQuizzes")}
      </Link>

      <div className="space-y-4 rounded-2xl border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-xl font-bold text-foreground">{quiz.title}</h1>
          <Badge
            variant="outline"
            className={cn("shrink-0", DIFFICULTY_STYLES[quiz.difficulty])}
          >
            {t(`difficulty.${quiz.difficulty}`)}
          </Badge>
        </div>

        <p className="text-sm text-muted-foreground">{quiz.description}</p>

        {/* The sitting rules, stated before the candidate commits to them. A
            timer that appears only after Start is a surprise, not a rule. */}
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Rule label={t("rules.questions")}>
            {t("questionCount", { count: quiz.questionCount })}
          </Rule>
          <Rule label={t("rules.timeLimit")}>
            {quiz.timeLimitSeconds === null
              ? t("rules.untimed")
              : t("rules.minutes", {
                  count: Math.round(quiz.timeLimitSeconds / 60),
                })}
          </Rule>
          <Rule label={t("rules.passMark")}>
            {format.number(quiz.passMarkPercent / 100, { style: "percent" })}
          </Rule>
          <Rule label={t("rules.attempts")}>
            {quiz.maxAttempts === null
              ? t("rules.unlimited")
              : t("rules.usedOf", { used, total: quiz.maxAttempts })}
          </Rule>
        </dl>

        {!user ? (
          <div className="space-y-2 rounded-lg border border-dashed p-4">
            <p className="text-sm text-muted-foreground">
              {t("signInToStart")}
            </p>
            <Button asChild className="w-full">
              <Link href={`/sign-in?next=/quiz/${slug}`}>{t("signIn")}</Link>
            </Button>
          </div>
        ) : exhausted ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {t("attemptsExhausted")}
          </p>
        ) : (
          <StartButton
            slug={slug}
            label={live ? t("resume") : t("start")}
            failureLabels={{
              exhausted: t("attemptsExhausted"),
              coolingDown: t("coolingDown"),
              generic: t("startFailed"),
            }}
          />
        )}
      </div>

      {attempts.length > 0 && (
        <section className="space-y-2 rounded-2xl border border-border bg-card p-5">
          <h2 className="font-semibold">{t("yourAttempts")}</h2>
          <ul className="divide-y text-sm">
            {attempts.map((attempt) => (
              <li
                key={attempt.id}
                className="flex items-center justify-between gap-3 py-2"
              >
                <span className="text-muted-foreground">
                  {t("attemptNumber", { number: attempt.attemptNumber })}
                </span>
                <span className="flex items-center gap-3">
                  {attempt.status === "in_progress" ? (
                    <span className="text-muted-foreground">
                      {t("statuses.inProgress")}
                    </span>
                  ) : (
                    <>
                      <span className="font-medium">
                        {format.number(
                          (attempt.maxScore ?? 0) > 0
                            ? (attempt.score ?? 0) / (attempt.maxScore ?? 1)
                            : 0,
                          { style: "percent" },
                        )}
                      </span>
                      {quiz.reviewPolicy !== "never" && (
                        <Link
                          href={`/quiz/${slug}/attempts/${attempt.id}`}
                          className="underline underline-offset-4"
                        >
                          {t("review")}
                        </Link>
                      )}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Rule({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="font-medium text-foreground">{children}</dd>
    </div>
  );
}
