"use client";

import React, { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import LessonCard from "./lesson-card";
import type { LessonSummary } from "@/db/queries/lessons";
import { CatalogueSearch } from "@/components/customs/catalogue-search";
import { useInfiniteReveal } from "@/hooks/use-infinite-reveal";
import { searchCatalogue, type SearchField } from "@/lib/search/catalogue";

type Difficulty = "all" | "easy" | "medium" | "hard";

const difficulties: Difficulty[] = ["all", "easy", "medium", "hard"];

/**
 * How many rows the first render holds, and how many each reveal adds.
 *
 * Six, not four: the rows are single-column now, so six is roughly a screen
 * and a half on a laptop — far enough that the reveal has fired before the
 * reader reaches the end, short enough that the initial HTML stays small.
 */
const PAGE_SIZE = 6;

/**
 * Where a lesson's text is searched, and what a hit in each part is worth.
 *
 * Title above category above description. A reader typing "acids" wants the
 * lesson CALLED that before the one that mentions it in passing, and without
 * the weights the longest description wins every query — it simply contains
 * more words.
 */
const LESSON_FIELDS: SearchField<LessonSummary>[] = [
  { read: (lesson) => lesson.title, weight: 3 },
  { read: (lesson) => lesson.category, weight: 2 },
  { read: (lesson) => lesson.description, weight: 1 },
];

export default function LessonOverviewPage({
  lessons,
}: {
  lessons: LessonSummary[];
}) {
  const t = useTranslations("lessons");
  const tTranslation = useTranslations("translation");
  const [activeDiff, setActiveDiff] = useState<Difficulty>("all");
  const [query, setQuery] = useState("");

  // The notice now reflects the data instead of a hardcoded locale check: a
  // lesson carries `isTranslated` when a translation row exists for the active
  // locale. Chemistry is not machine-translated, so an untranslated catalogue
  // is shown as-is and said so.
  const contentIsTranslated = lessons.every((lesson) => lesson.isTranslated);

  /**
   * Curriculum position, resolved once.
   *
   * The number on a row is the lesson's place in the course, not its place in
   * whatever the reader has filtered down to — lesson 9 stays lesson 9 when
   * only the hard ones are showing. It used to be `lessons.indexOf(lesson)`
   * inside the render loop, which is the same answer computed n times and
   * wrong the moment two rows are equal by identity.
   */
  const positions = useMemo(() => {
    const map = new Map<string, number>();
    lessons.forEach((lesson, index) => map.set(lesson.slug, index + 1));
    return map;
  }, [lessons]);

  const byDifficulty = useMemo(
    () =>
      activeDiff === "all"
        ? lessons
        : lessons.filter((lesson) => lesson.difficulty === activeDiff),
    [lessons, activeDiff],
  );

  // Memoised on the query text, so typing does not re-rank the catalogue for
  // every unrelated re-render — and so the array identity is stable, which is
  // what `useInfiniteReveal` slices.
  const results = useMemo(
    () =>
      searchCatalogue({ items: byDifficulty, query, fields: LESSON_FIELDS }),
    [byDifficulty, query],
  );

  const { visible, hasMore, remaining, sentinelRef, revealMore } =
    useInfiniteReveal({
      items: results,
      pageSize: PAGE_SIZE,
      // Both inputs, because both change the list. Leaving the query out is
      // the bug where narrowing a search keeps showing forty rows.
      resetKey: `${activeDiff}|${query}`,
    });

  const searching = query.trim() !== "";

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      {/* Page Header */}
      <div className="mb-8">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-primary-text">
          {t("eyebrow")}
        </p>
        <h1 className="mb-3 font-serif text-4xl font-bold leading-tight text-foreground">
          {t.rich("heading", {
            highlight: (chunks) => (
              <span className="text-primary-text">{chunks}</span>
            ),
          })}
        </h1>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          {t("intro")}
        </p>
      </div>

      <div className="mb-6">
        <CatalogueSearch
          id="lesson-search"
          value={query}
          onChange={setQuery}
          label={t("searchLabel")}
          placeholder={t("searchPlaceholder")}
          clearLabel={t("clearSearch")}
          resultSummary={t("lessonCount", { count: results.length })}
        />
      </div>

      {/* Difficulty Filter */}
      <div className="mb-8 flex flex-wrap items-center gap-2">
        <span className="me-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          {t("filterLabel")}
        </span>
        {difficulties.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setActiveDiff(value)}
            aria-pressed={activeDiff === value}
            className={`rounded-full border px-4 py-1.5 text-xs font-bold tracking-wide transition-all duration-150 ${
              activeDiff === value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-transparent text-muted-foreground hover:border-primary/50 hover:text-primary-text"
            }`}
          >
            {t(`difficulty.${value}`)}
          </button>
        ))}
        <span className="ms-auto text-xs text-muted-foreground">
          {t("lessonCount", { count: results.length })}
        </span>
      </div>

      {/* Lesson titles are still English-only — say so instead of implying
          the catalogue has been translated. */}
      {!contentIsTranslated && results.length > 0 && (
        <div
          className="mb-6 rounded-lg border border-border bg-secondary px-4 py-3 text-sm"
          role="note"
        >
          <p className="font-semibold text-secondary-foreground">
            {tTranslation("notAvailableTitle")}
          </p>
          <p className="mt-0.5 text-muted-foreground">
            {tTranslation("notAvailableBody")}
          </p>
        </div>
      )}

      {/* Lessons — one per row, in curriculum order, or by relevance while a
          search is running. */}
      <div className="border-t border-border">
        {visible.map((lesson) => (
          <LessonCard
            key={lesson.slug}
            index={positions.get(lesson.slug) ?? 0}
            slug={lesson.slug}
            title={lesson.title}
            description={lesson.description}
            difficulty={lesson.difficulty}
            category={lesson.category}
          />
        ))}
      </div>

      {/* The sentinel. A button, not a marker div: see `useInfiniteReveal` —
          without a working IntersectionObserver this is the only way to reach
          the rest of the catalogue, and it is the only way at all from a
          keyboard. */}
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

      {results.length === 0 && (
        <div className="py-20 text-center">
          {/* Two different facts, said differently. "No lessons found" for a
              search that matched nothing reads as a broken catalogue; the
              reader needs their own query quoted back and a way out of it. */}
          {searching ? (
            <>
              <p className="text-sm text-foreground">
                {t("noMatches", { query: query.trim() })}
              </p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {t("noMatchesHint")}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          )}
        </div>
      )}
    </div>
  );
}
