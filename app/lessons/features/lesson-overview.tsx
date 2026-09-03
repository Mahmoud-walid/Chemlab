"use client";

import React, { useState } from "react";
import LessonCard from "./lesson-card";
import lessons from "@/data/lessons.json";

type Difficulty = "all" | "easy" | "medium" | "hard";

const filterButtons: { label: string; value: Difficulty }[] = [
  { label: "All", value: "all" },
  { label: "Easy", value: "easy" },
  { label: "Medium", value: "medium" },
  { label: "Hard", value: "hard" },
];

export default function LessonOverviewPage() {
  const [activeDiff, setActiveDiff] = useState<Difficulty>("all");

  const filtered =
    activeDiff === "all"
      ? lessons
      : lessons.filter((l) => l.difficulty === activeDiff);

  return (
    <div className="px-6 py-10 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="mb-10">
        <p className="text-[11px] font-bold tracking-[0.18em] uppercase text-primary mb-2">
          Course Curriculum
        </p>
        <h1 className="font-serif text-4xl font-bold leading-tight text-foreground mb-3">
          Chemistry <span className="text-primary">Fundamentals</span>
        </h1>
        <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
          A structured journey through chemical principles — from atomic theory
          to organic molecules.
        </p>
      </div>

      {/* Difficulty Filter */}
      <div className="flex items-center gap-2 flex-wrap mb-8">
        <span className="text-[11px] font-bold tracking-widest uppercase text-muted-foreground mr-1">
          Filter
        </span>
        {filterButtons.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => setActiveDiff(value)}
            className={`text-xs font-bold tracking-wide px-4 py-1.5 rounded-full border transition-all duration-150 ${
              activeDiff === value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-transparent text-muted-foreground border-border hover:border-primary/50 hover:text-primary"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} lesson{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Lessons Grid */}
      <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((lesson) => (
          <LessonCard
            key={lesson.slug}
            index={lessons.indexOf(lesson) + 1}
            slug={lesson.slug}
            title={lesson.title}
            description={lesson.description}
            difficulty={lesson.difficulty as "easy" | "medium" | "hard"}
            category={lesson.category}
          />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-20 text-muted-foreground text-sm">
          No lessons found for this difficulty.
        </div>
      )}
    </div>
  );
}
