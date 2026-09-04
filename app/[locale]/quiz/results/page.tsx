"use client";

import { useMemo } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { Link } from "@/i18n/navigation";
import { type QuizAttempt, type Difficulty } from "@/types/quiz";
import {
  clearAttempts,
  gradeLabel,
  parseAttempts,
  percentage,
  QUIZ_STORAGE_KEY,
} from "@/lib/quiz-storage";
import { useStoredValue } from "@/hooks/use-stored-value";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { Clock, Trash2, BookOpen } from "lucide-react";

const DIFFICULTY_STYLES: Record<Difficulty, string> = {
  easy: "bg-chart-5/20 text-chart-5 border-chart-5/40",
  medium: "bg-chart-4/20 text-chart-4 border-chart-4/40",
  hard: "bg-destructive/15 text-destructive border-destructive/30",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─────────────────────────────────────────────
//  RESULT CARD
// ─────────────────────────────────────────────
function ResultCard({ attempt }: { attempt: QuizAttempt }) {
  const t = useTranslations("quiz");
  const format = useFormatter();
  const pct = percentage(attempt.score, attempt.total);
  const grade = gradeLabel(pct);

  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-3">
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <p className="font-semibold text-foreground text-sm leading-snug">
            {attempt.title}
          </p>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            {formatDate(attempt.completedAt)}
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "capitalize shrink-0 text-xs",
            DIFFICULTY_STYLES[attempt.difficulty],
          )}
        >
          {attempt.difficulty}
        </Badge>
      </div>

      {/* Score */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className={cn("font-semibold", grade.className)}>
            {t(`grade.${grade.key}`)}
          </span>
          <span className="text-muted-foreground">
            {t("scoreOf", { score: attempt.score, total: attempt.total })} ·{" "}
            {format.number(pct / 100, { style: "percent" })}
          </span>
        </div>
        <Progress value={pct} className="h-1.5" />
      </div>

      {/* Retake */}
      <Button variant="outline" size="sm" className="w-full" asChild>
        <Link href={`/quiz/${attempt.slug}`}>{t("retake")}</Link>
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────
//  SUMMARY STATS
// ─────────────────────────────────────────────
function SummaryStats({ attempts }: { attempts: QuizAttempt[] }) {
  const t = useTranslations("quiz");
  const format = useFormatter();
  if (attempts.length === 0) return null;

  const avgPct = Math.round(
    attempts.reduce((sum, a) => sum + percentage(a.score, a.total), 0) /
      attempts.length,
  );
  const best = attempts.reduce((b, a) =>
    percentage(a.score, a.total) > percentage(b.score, b.total) ? a : b,
  );

  return (
    <div className="grid grid-cols-3 gap-3 mb-6">
      {[
        {
          label: t("results.quizzesTaken"),
          value: format.number(attempts.length),
        },
        {
          label: t("results.averageScore"),
          value: format.number(avgPct / 100, { style: "percent" }),
        },
        {
          label: t("results.bestQuiz"),
          value: best.title.split(" ").slice(0, 2).join(" "),
        },
      ].map(({ label, value }) => (
        <div
          key={label}
          className="rounded-xl border border-border bg-card px-3 py-3 text-center space-y-0.5"
        >
          <p className="text-lg font-bold text-foreground">{value}</p>
          <p className="text-[10px] sm:text-xs text-muted-foreground">
            {label}
          </p>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
//  PAGE
// ─────────────────────────────────────────────
export default function ResultsPage() {
  const t = useTranslations("quiz");
  // Read from sessionStorage (client-only); re-renders when it changes.
  const stored = useStoredValue("session", QUIZ_STORAGE_KEY);
  const attempts = useMemo(() => parseAttempts(stored), [stored]);

  function handleClear() {
    clearAttempts();
  }

  return (
    <div className="min-h-screen bg-background w-full px-4 py-6 sm:px-6 lg:px-10">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            {t("results.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("results.sessionOnly")}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {attempts.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={handleClear}
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t("results.clearShort")}
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <Link href="/quiz">{t("results.allQuizzes")}</Link>
          </Button>
        </div>
      </div>

      {/* Empty state */}
      {attempts.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
            <BookOpen className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="font-medium text-foreground">{t("noResults")}</p>
          <p className="text-sm text-muted-foreground max-w-xs">
            {t("results.emptyBody")}
          </p>
          <Button asChild size="sm" className="mt-1">
            <Link href="/quiz">{t("browseQuizzes")}</Link>
          </Button>
        </div>
      ) : (
        <>
          <SummaryStats attempts={attempts} />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {attempts.map((attempt) => (
              <ResultCard
                key={`${attempt.slug}-${attempt.completedAt}`}
                attempt={attempt}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
