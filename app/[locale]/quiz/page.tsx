"use client";

import { useState } from "react";
import { useLocale, useFormatter, useTranslations } from "next-intl";
import { isRtl } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import quizData from "@/data/quiz.json";
import { type Quiz, type Difficulty } from "@/types/quiz";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, ClipboardList } from "lucide-react";

// ─────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────
const ALL_QUIZZES = quizData as Quiz[];
const PAGE_SIZE = 4;

const DIFFICULTY_STYLES: Record<Difficulty, string> = {
  easy: "bg-chart-5/20 text-chart-5-on-tint border-chart-5/40",
  medium: "bg-chart-4/20 text-chart-4-on-tint border-chart-4/40",
  hard: "bg-destructive/15 text-destructive-on-tint border-destructive/30",
};

const FILTERS: (Difficulty | "all")[] = ["all", "easy", "medium", "hard"];

// ─────────────────────────────────────────────
//  QUIZ CARD
// ─────────────────────────────────────────────
function QuizCard({ quiz }: { quiz: Quiz }) {
  const t = useTranslations("quiz");

  return (
    <Card className="flex flex-col h-full hover:shadow-md transition-shadow duration-200">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-snug">{quiz.title}</CardTitle>
          <Badge
            variant="outline"
            className={cn(
              "shrink-0 text-xs",
              DIFFICULTY_STYLES[quiz.difficulty],
            )}
          >
            {t(`difficulty.${quiz.difficulty}`)}
          </Badge>
        </div>
        <CardDescription className="text-xs mt-1">
          {quiz.description}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex-1 pb-3">
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <ClipboardList className="w-3 h-3" />
            {t("questionCount", { count: quiz.questions.length })}
          </span>
          <span className="inline-flex items-center gap-1 bg-muted px-2 py-0.5 rounded-full">
            {quiz.category}
          </span>
        </div>
      </CardContent>

      <CardFooter className="pt-0">
        <Button asChild className="w-full" size="sm">
          <Link href={`/quiz/${quiz.slug}`}>{t("start")}</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

// ─────────────────────────────────────────────
//  PAGE
// ─────────────────────────────────────────────
export default function QuizPage() {
  const t = useTranslations("quiz");
  const format = useFormatter();
  const locale = useLocale();

  // "Previous" and "Next" point backwards and forwards in reading order, so
  // the chevrons swap in an RTL locale.
  const PreviousIcon = isRtl(locale) ? ChevronRight : ChevronLeft;
  const NextIcon = isRtl(locale) ? ChevronLeft : ChevronRight;

  const [filter, setFilter] = useState<Difficulty | "all">("all");
  const [page, setPage] = useState(1);

  const filtered =
    filter === "all"
      ? ALL_QUIZZES
      : ALL_QUIZZES.filter((q) => q.difficulty === filter);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function handleFilter(value: Difficulty | "all") {
    setFilter(value);
    setPage(1); // reset to page 1 on filter change
  }

  return (
    <div className="min-h-screen bg-background w-full px-4 py-6 sm:px-6 lg:px-10">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("subtitle", { count: ALL_QUIZZES.length })}
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/quiz/results">{t("myResults")}</Link>
        </Button>
      </div>

      {/* Difficulty filter pills */}
      <div className="flex flex-wrap gap-2 mb-6">
        {FILTERS.map((value) => (
          <button
            key={value}
            onClick={() => handleFilter(value)}
            aria-pressed={filter === value}
            className={cn(
              "px-3 py-1 rounded-full text-sm border transition-all duration-150",
              filter === value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted text-muted-foreground border-border hover:border-primary/50",
            )}
          >
            {t(`difficulty.${value}`)}
            <span className="ms-1.5 text-xs opacity-70">
              {format.number(
                value === "all"
                  ? ALL_QUIZZES.length
                  : ALL_QUIZZES.filter((q) => q.difficulty === value).length,
              )}
            </span>
          </button>
        ))}
      </div>

      {/* Quiz grid */}
      {paginated.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-6">
          {paginated.map((quiz) => (
            <QuizCard key={quiz.slug} quiz={quiz} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            aria-label={t("pagination.previous")}
          >
            <PreviousIcon className="w-4 h-4" />
          </Button>

          <span className="text-sm text-muted-foreground">
            {t("pagination.page", { current: page, total: totalPages })}
          </span>

          <Button
            variant="outline"
            size="icon"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            aria-label={t("pagination.next")}
          >
            <NextIcon className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
