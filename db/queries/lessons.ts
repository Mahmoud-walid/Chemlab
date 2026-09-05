import "server-only";
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import {
  lessonSectionTranslations,
  lessonSections,
  lessonTranslations,
  lessons,
} from "@/db/schema/content";

import {
  blocksToText,
  parseBlocks,
  type LessonBlock,
} from "@/lib/lessons/blocks";
import {
  chooseTranslation,
  preferred,
  showsStaleNotice,
  usesTranslation,
} from "./_locale";
import { translationState } from "./translations";

export interface LessonSummary {
  slug: string;
  title: string;
  description: string;
  difficulty: "easy" | "medium" | "hard";
  category: string;
  /** False when this locale has no translation row and the default copy is shown. */
  isTranslated: boolean;
  /**
   * True when the reader is being shown a translation the source has moved on
   * from. Never true when `isTranslated` is false — a fallback cannot be out
   * of date, it is the source.
   */
  translationOutOfDate: boolean;
}

export interface LessonSectionView {
  /** Stable across locales: the anchor a table-of-contents entry links to. */
  id: string;
  anchor: string;
  heading: string;
  body: LessonBlock[];
  /** Plain text, for the excerpt and for anything not rendering blocks. */
  text: string;
}

export interface LessonDetail extends LessonSummary {
  /**
   * The row id, which the page passes to the comment API as its subject.
   *
   * Exposed deliberately: comments are polymorphic over
   * `(subject_type, subject_id)`, so the API takes an id rather than a slug —
   * teaching it to resolve lesson slugs would tie a generic surface to one
   * subject type. A lesson id identifies public content and is validated as a
   * uuid on the way in.
   */
  id: string;
  references: string[];
  sections: LessonSectionView[];
  /** Stored, not computed per request — see lib/lessons/reading-time.ts. */
  readingTimeSeconds: number;
  position: number;
}

/** A card in the "read next" strip. */
export interface RelatedLesson {
  slug: string;
  title: string;
  category: string;
  difficulty: "easy" | "medium" | "hard";
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
      ...translationState(lessonTranslations, lessons),
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

  return rows.map((row) => {
    const choice = chooseTranslation(
      {
        present: row.translatedTitle !== null,
        status: row.translationStatus,
        stale: row.translationStale,
      },
      "prose",
    );
    const translated = usesTranslation(choice);

    return {
      slug: row.slug,
      title: translated ? preferred(row.translatedTitle, row.title) : row.title,
      description: translated
        ? preferred(row.translatedDescription, row.description)
        : row.description,
      difficulty: row.difficulty,
      category: row.category,
      isTranslated: translated,
      translationOutOfDate: showsStaleNotice(choice),
    };
  });
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
      readingTimeSeconds: lessons.readingTimeSeconds,
      position: lessons.position,
      ...translationState(lessonTranslations, lessons),
      translatedTitle: lessonTranslations.title,
      translatedDescription: lessonTranslations.description,
      ...translationState(lessonTranslations, lessons),
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
      id: lessonSections.id,
      position: lessonSections.position,
      heading: lessonSections.heading,
      body: lessonSections.body,
      translatedHeading: lessonSectionTranslations.heading,
      translatedBody: lessonSectionTranslations.body,
      ...translationState(lessonSectionTranslations, lessonSections),
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

  const lessonChoice = chooseTranslation(
    {
      present: lesson.translatedTitle !== null,
      status: lesson.translationStatus,
      stale: lesson.translationStale,
    },
    "prose",
  );
  const lessonTranslated = usesTranslation(lessonChoice);

  // Each section decides for itself. A lesson whose summary is current can
  // easily have one section rewritten in English and not yet in Arabic, and
  // marking the whole article out of date for that would be as unhelpful as
  // saying nothing.
  const sectionChoices = sections.map((section) =>
    chooseTranslation(
      {
        present: section.translatedHeading !== null,
        status: section.translationStatus,
        stale: section.translationStale,
      },
      "prose",
    ),
  );

  return {
    id: lesson.id,
    slug: lesson.slug,
    title: lessonTranslated
      ? preferred(lesson.translatedTitle, lesson.title)
      : lesson.title,
    description: lessonTranslated
      ? preferred(lesson.translatedDescription, lesson.description)
      : lesson.description,
    difficulty: lesson.difficulty,
    category: lesson.category,
    references: lesson.references,
    readingTimeSeconds: lesson.readingTimeSeconds,
    position: lesson.position,
    isTranslated: lessonTranslated,
    // The notice is about the ARTICLE, so any out-of-date part earns it: a
    // reader told "the summary is current" while section four is a year old
    // has been told the wrong thing.
    translationOutOfDate:
      showsStaleNotice(lessonChoice) || sectionChoices.some(showsStaleNotice),
    sections: sections.map((section, index) => {
      const useTranslation = usesTranslation(sectionChoices[index]!);
      const body = useTranslation
        ? preferred(section.translatedBody, section.body)
        : section.body;
      const heading = useTranslation
        ? preferred(section.translatedHeading, section.heading)
        : section.heading;
      return {
        id: section.id,
        // Anchored on POSITION, not on the heading text: the anchor has to be
        // the same in both locales or a link shared from the Arabic page would
        // not resolve on the English one, and translating a heading would
        // silently break every link into it.
        anchor: `section-${section.position + 1}`,
        heading,
        body: parseBlocks(body),
        text: blocksToText(parseBlocks(body)),
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

/**
 * What to read next: same category first, then the neighbours in curriculum
 * order.
 *
 * Ranked in SQL rather than by loading the catalogue and sorting in
 * TypeScript — the catalogue is small today, and a query that only gets slower
 * with the content is the wrong shape to leave behind.
 */
export async function relatedLessons(
  slug: string,
  locale: string,
  limit = 3,
): Promise<RelatedLesson[]> {
  const db = getDb();

  const [current] = await db
    .select({
      id: lessons.id,
      category: lessons.category,
      difficulty: lessons.difficulty,
      position: lessons.position,
    })
    .from(lessons)
    .where(eq(lessons.slug, slug))
    .limit(1);

  if (!current) return [];

  const rows = await db
    .select({
      slug: lessons.slug,
      title: lessons.title,
      category: lessons.category,
      difficulty: lessons.difficulty,
      ...translationState(lessonTranslations, lessons),
      translatedTitle: lessonTranslations.title,
      ...translationState(lessonTranslations, lessons),
      score: sql<number>`
        (case when ${lessons.category} = ${current.category} then 2 else 0 end)
        + (case when ${lessons.difficulty} = ${current.difficulty} then 1 else 0 end)
      `.as("score"),
      distance: sql<number>`abs(${lessons.position} - ${current.position})`.as(
        "distance",
      ),
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
        eq(lessons.status, "published"),
        isNull(lessons.deletedAt),
        ne(lessons.id, current.id),
      ),
    )
    // Overlap first, then curriculum proximity, then slug so the strip is the
    // same on every request rather than following physical row order.
    .orderBy(desc(sql`score`), asc(sql`distance`), asc(lessons.slug))
    .limit(limit);

  return rows.map((row) => ({
    slug: row.slug,
    title: usesTranslation(
      chooseTranslation(
        {
          present: row.translatedTitle !== null,
          status: row.translationStatus,
          stale: row.translationStale,
        },
        "prose",
      ),
    )
      ? preferred(row.translatedTitle, row.title)
      : row.title,
    category: row.category,
    difficulty: row.difficulty,
  }));
}
