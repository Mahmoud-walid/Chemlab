import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";

import { getDb } from "@/db/client";
import {
  lessonSectionTranslations,
  lessonSections,
  lessonTranslations,
  lessons,
} from "@/db/schema/content";
import { richTextToText } from "@/db/seed/transform";
import type { RichTextDoc } from "@/db/schema/content";
import { preferred } from "./_locale";

export interface LessonSummary {
  slug: string;
  title: string;
  description: string;
  difficulty: "easy" | "medium" | "hard";
  category: string;
  /** False when this locale has no translation row and the default copy is shown. */
  isTranslated: boolean;
}

export interface LessonSectionView {
  heading: string;
  body: RichTextDoc;
  /** Plain-text rendering, for the components that have not moved to rich text yet. */
  text: string;
}

export interface LessonDetail extends LessonSummary {
  references: string[];
  sections: LessonSectionView[];
}

/**
 * The lesson catalogue for one locale.
 *
 * A left join, not a second query: a missing translation is an absent row, so
 * the join returns null and `preferred` falls back to the default-locale copy
 * on the base table.
 */
export async function listLessons(locale: string): Promise<LessonSummary[]> {
  const rows = await getDb()
    .select({
      slug: lessons.slug,
      title: lessons.title,
      description: lessons.description,
      difficulty: lessons.difficulty,
      category: lessons.category,
      translatedTitle: lessonTranslations.title,
      translatedDescription: lessonTranslations.description,
    })
    .from(lessons)
    .leftJoin(
      lessonTranslations,
      and(
        eq(lessonTranslations.lessonId, lessons.id),
        eq(lessonTranslations.locale, locale),
      ),
    )
    // Draft, archived and soft-deleted lessons keep their rows but must not be
    // listed. The status column is the single answer to "is this live" —
    // `published_at` only records when it first became so.
    .where(and(eq(lessons.status, "published"), isNull(lessons.deletedAt)))
    // Curriculum order first, slug as the tiebreak so the numbering on the
    // overview page is stable between requests rather than following
    // Postgres' physical row order.
    .orderBy(asc(lessons.position), asc(lessons.slug));

  return rows.map((row) => ({
    slug: row.slug,
    title: preferred(row.translatedTitle, row.title),
    description: preferred(row.translatedDescription, row.description),
    difficulty: row.difficulty,
    category: row.category,
    isTranslated: row.translatedTitle !== null,
  }));
}

/** One lesson with its ordered sections, or null when the slug matches nothing. */
export async function getLessonBySlug(
  slug: string,
  locale: string,
): Promise<LessonDetail | null> {
  const db = getDb();

  const [lesson] = await db
    .select({
      id: lessons.id,
      slug: lessons.slug,
      title: lessons.title,
      description: lessons.description,
      difficulty: lessons.difficulty,
      category: lessons.category,
      references: lessons.references,
      translatedTitle: lessonTranslations.title,
      translatedDescription: lessonTranslations.description,
    })
    .from(lessons)
    .leftJoin(
      lessonTranslations,
      and(
        eq(lessonTranslations.lessonId, lessons.id),
        eq(lessonTranslations.locale, locale),
      ),
    )
    .where(
      and(
        eq(lessons.slug, slug),
        eq(lessons.status, "published"),
        isNull(lessons.deletedAt),
      ),
    )
    .limit(1);

  if (!lesson) return null;

  const sections = await db
    .select({
      heading: lessonSections.heading,
      body: lessonSections.body,
      translatedHeading: lessonSectionTranslations.heading,
      translatedBody: lessonSectionTranslations.body,
    })
    .from(lessonSections)
    .leftJoin(
      lessonSectionTranslations,
      and(
        eq(lessonSectionTranslations.sectionId, lessonSections.id),
        eq(lessonSectionTranslations.locale, locale),
      ),
    )
    .where(eq(lessonSections.lessonId, lesson.id))
    .orderBy(asc(lessonSections.position));

  return {
    slug: lesson.slug,
    title: preferred(lesson.translatedTitle, lesson.title),
    description: preferred(lesson.translatedDescription, lesson.description),
    difficulty: lesson.difficulty,
    category: lesson.category,
    references: lesson.references,
    isTranslated: lesson.translatedTitle !== null,
    sections: sections.map((section) => {
      const body = preferred(section.translatedBody, section.body);
      return {
        heading: preferred(section.translatedHeading, section.heading),
        body,
        text: richTextToText(body),
      };
    }),
  };
}

/** Slugs only — for `generateStaticParams` and the sitemap. */
export async function listLessonSlugs(): Promise<string[]> {
  const rows = await getDb()
    .select({ slug: lessons.slug })
    .from(lessons)
    .where(and(eq(lessons.status, "published"), isNull(lessons.deletedAt)))
    .orderBy(asc(lessons.position), asc(lessons.slug));
  return rows.map((row) => row.slug);
}
