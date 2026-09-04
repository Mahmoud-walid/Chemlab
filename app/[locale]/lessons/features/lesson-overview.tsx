"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import LessonCard from "./lesson-card";
import type { LessonSummary } from "@/db/queries/lessons";

type Difficulty = "all" | "easy" | "medium" | "hard";

const difficulties: Difficulty[] = ["all", "easy", "medium", "hard"];

export default function LessonOverviewPage({
  lessons,
}: {
  lessons: LessonSummary[];
}) {
  const t = useTranslations("lessons");
  const tTranslation = useTranslations("translation");
  const [activeDiff, setActiveDiff] = useState<Difficulty>("all");

  // The notice now reflects the data instead of a hardcoded locale check: a
  // lesson carries `isTranslated` when a translation row exists for the active
  // locale. Chemistry is not machine-translated, so an untranslated catalogue
  // is shown as-is and said so.
  const contentIsTranslated = lessons.every((lesson) => lesson.isTranslated);

  const filtered =
    activeDiff === "all"
      ? lessons
      : lessons.filter((l) => l.difficulty === activeDiff);

  return (
    <div className="px-6 py-10 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="mb-10">
        <p className="text-[11px] font-bold tracking-[0.18em] uppercase text-primary-text mb-2">
          {t("eyebrow")}
        </p>
        <h1 className="font-serif text-4xl font-bold leading-tight text-foreground mb-3">
          {t.rich("heading", {
            highlight: (chunks) => (
              <span className="text-primary-text">{chunks}</span>
            ),
          })}
        </h1>
        <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
          {t("intro")}
        </p>
      </div>

      {/* Difficulty Filter */}
      <div className="flex items-center gap-2 flex-wrap mb-8">
        <span className="text-[11px] font-bold tracking-widest uppercase text-muted-foreground me-1">
          {t("filterLabel")}
        </span>
        {difficulties.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setActiveDiff(value)}
            aria-pressed={activeDiff === value}
            className={`text-xs font-bold tracking-wide px-4 py-1.5 rounded-full border transition-all duration-150 ${
              activeDiff === value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-transparent text-muted-foreground border-border hover:border-primary/50 hover:text-primary-text"
            }`}
          >
            {t(`difficulty.${value}`)}
          </button>
        ))}
        <span className="ms-auto text-xs text-muted-foreground">
          {t("lessonCount", { count: filtered.length })}
        </span>
      </div>

      {/* Lesson titles are still English-only — say so instead of implying
          the catalogue has been translated. */}
      {!contentIsTranslated && filtered.length > 0 && (
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

      {/* Lessons Grid */}
      <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((lesson) => (
          <LessonCard
            key={lesson.slug}
            index={lessons.indexOf(lesson) + 1}
            slug={lesson.slug}
            title={lesson.title}
            description={lesson.description}
            difficulty={lesson.difficulty}
            category={lesson.category}
          />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-20 text-muted-foreground text-sm">
          {t("empty")}
        </div>
      )}
    </div>
  );
}
