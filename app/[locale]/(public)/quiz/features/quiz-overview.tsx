"use client";

import { useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { QuizSummary } from "@/db/queries/quizzes";
import { type Difficulty } from "@/types/quiz";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CatalogueSearch } from "@/components/customs/catalogue-search";
import { useInfiniteReveal } from "@/hooks/use-infinite-reveal";
import { searchCatalogue, type SearchField } from "@/lib/search/catalogue";
import { cn } from "@/lib/utils";
import { ClipboardList } from "lucide-react";

// ─────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────

/**
 * How many rows the first render holds, and how many each reveal adds.
 *
 * Four, which is what the previous/next buttons this replaces used, and it is
 * deliberately smaller than the lessons page's six. There are six quizzes. A
 * page size of six would mean the reveal never runs at all on the catalogue as
 * it stands — not a bug, but an untested code path that would first execute on
 * the day somebody publishes a seventh quiz.
 */
const PAGE_SIZE = 4;

const DIFFICULTY_STYLES: Record<Difficulty, string> = {
  easy: "bg-chart-5/20 text-chart-5-on-tint border-chart-5/40",
  medium: "bg-chart-4/20 text-chart-4-on-tint border-chart-4/40",
  hard: "bg-destructive/15 text-destructive-on-tint border-destructive/30",
};

const FILTERS: (Difficulty | "all")[] = ["all", "easy", "medium", "hard"];

/**
 * Where a quiz's text is searched, and what a hit in each part is worth.
 *
 * The same weighting as the lesson catalogue, for the same reason: the title
 * is what the reader typed, and an unweighted search is won by whichever
 * description happens to be longest.
 */
const QUIZ_FIELDS: SearchField<QuizSummary>[] = [
  { read: (quiz) => quiz.title, weight: 3 },
  { read: (quiz) => quiz.category, weight: 2 },
  { read: (quiz) => quiz.description, weight: 1 },
];

// ─────────────────────────────────────────────
//  QUIZ ROW
// ─────────────────────────────────────────────

/**
 * One quiz, as a full-width row.
 *
 * Not a `Card` any more: a card in a four-column grid put the description in a
 * 10-pixel font two words wide, so the only thing a reader could actually
 * compare was the title. One column per quiz gives the description the width
 * it needs and reads the same on a phone.
 *
 * The whole row is NOT a link, unlike the lesson rows. Starting a quiz is a
 * commitment with attempt limits and a timer behind it, and a row that begins
 * one because the reader tapped near it is a lost attempt. The button is the
 * only thing that starts it.
 */
function QuizRow({ quiz }: { quiz: QuizSummary }) {
  const t = useTranslations("quiz");

  return (
    <div className="flex flex-col gap-4 border-b border-border px-1 py-6 transition-colors duration-150 hover:bg-muted/40 sm:flex-row sm:items-center sm:gap-6 sm:px-2">
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <span className="text-[10.5px] font-bold uppercase tracking-widest text-primary-text">
            {quiz.category}
          </span>
          <Badge
            variant="outline"
            className={cn(
              "shrink-0 text-[10px]",
              DIFFICULTY_STYLES[quiz.difficulty],
            )}
          >
            {t(`difficulty.${quiz.difficulty}`)}
          </Badge>
        </div>

        <h2 className="font-serif text-lg font-bold leading-snug text-foreground sm:text-xl">
          {quiz.title}
        </h2>

        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {quiz.description}
        </p>

        <p className="mt-3 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <ClipboardList aria-hidden className="size-3" />
          {t("questionCount", { count: quiz.questionCount })}
        </p>
      </div>

      <Button asChild size="sm" className="shrink-0 sm:w-32">
        {/* The quiz title is in the accessible name: a column of buttons all
            called "Start quiz" tells a screen-reader user which one they are
            on and nothing about which quiz it starts. */}
        <Link
          href={`/quiz/${quiz.slug}`}
          aria-label={`${t("start")}: ${quiz.title}`}
        >
          {t("start")}
        </Link>
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────
//  PAGE
// ─────────────────────────────────────────────
export default function QuizOverview({ quizzes }: { quizzes: QuizSummary[] }) {
  const t = useTranslations("quiz");
  const format = useFormatter();

  const [filter, setFilter] = useState<Difficulty | "all">("all");
  const [query, setQuery] = useState("");

  const byDifficulty = useMemo(
    () =>
      filter === "all"
        ? quizzes
        : quizzes.filter((quiz) => quiz.difficulty === filter),
    [quizzes, filter],
  );

  const results = useMemo(
    () => searchCatalogue({ items: byDifficulty, query, fields: QUIZ_FIELDS }),
    [byDifficulty, query],
  );

  const { visible, hasMore, remaining, sentinelRef, revealMore } =
    useInfiniteReveal({
      items: results,
      pageSize: PAGE_SIZE,
      // Both inputs, because both change the list — see `useInfiniteReveal`.
      // The previous version reset the page number on a filter change for the
      // same reason: staying on page 4 of the old result set showed an empty
      // list and read as "no matches".
      resetKey: `${filter}|${query}`,
    });

  const searching = query.trim() !== "";

  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl bg-background px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("subtitle", { count: quizzes.length })}
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/profile/exams">{t("seeAllResults")}</Link>
        </Button>
      </div>

      <div className="mb-6">
        <CatalogueSearch
          id="quiz-search"
          value={query}
          onChange={setQuery}
          label={t("searchLabel")}
          placeholder={t("searchPlaceholder")}
          clearLabel={t("clearSearch")}
          resultSummary={t("quizCount", { count: results.length })}
        />
      </div>

      {/* Difficulty filter pills */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="me-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          {t("filterLabel")}
        </span>
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            aria-pressed={filter === value}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-all duration-150",
              filter === value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-muted text-muted-foreground hover:border-primary/50",
            )}
          >
            {t(`difficulty.${value}`)}
            {/* The count is of the whole catalogue at that difficulty, not of
                the current search: a pill that read "0" while a search was
                running would look like the filter was broken rather than like
                the search had narrowed things. */}
            <span className="ms-1.5 text-xs opacity-70">
              {format.number(
                value === "all"
                  ? quizzes.length
                  : quizzes.filter((quiz) => quiz.difficulty === value).length,
              )}
            </span>
          </button>
        ))}
        <span className="ms-auto text-xs text-muted-foreground">
          {t("quizCount", { count: results.length })}
        </span>
      </div>

      {/* Quizzes — one per row, in catalogue order, or by relevance while a
          search is running. */}
      <div className="border-t border-border">
        {visible.map((quiz) => (
          <QuizRow key={quiz.slug} quiz={quiz} />
        ))}
      </div>

      {/* The sentinel. A button, not a marker div: see `useInfiniteReveal`. */}
      {hasMore && (
        <div className="flex justify-center py-8">
          <button
            ref={sentinelRef}
            type="button"
            onClick={revealMore}
            className="rounded-full border border-border px-5 py-2 text-xs font-bold tracking-wide text-muted-foreground transition-colors duration-150 hover:border-primary/50 hover:text-primary-text"
          >
            {t("loadMore", { count: remaining })}
          </button>
        </div>
      )}

      {results.length === 0 &&
        (searching ? (
          <div className="py-16 text-center">
            <p className="text-sm text-foreground">
              {t("noMatches", { query: query.trim() })}
            </p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {t("noMatchesHint")}
            </p>
          </div>
        ) : (
          <p className="py-16 text-center text-sm text-muted-foreground">
            {t("empty")}
          </p>
        ))}
    </div>
  );
}
