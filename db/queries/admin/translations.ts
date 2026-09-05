import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import {
  lessonSectionTranslations,
  lessonSections,
  lessonTranslations,
  lessons,
} from "@/db/schema/content";
import { blocksSchema, type LessonBlock } from "@/lib/lessons/blocks";
import { valuesFromBlocks } from "@/lib/translations/blocks";
import type { TranslationState } from "@/lib/translations/state";
import { currentSourceHash } from "@/db/queries/translations";

/**
 * Reading and writing one lesson's translation into one locale.
 *
 * The source and the translation are fetched together, always. A translator
 * working from a screen that does not show the English is translating from
 * memory, and a form that posts without the source has no way to know which
 * blocks it is answering.
 */

export interface TranslatableSection {
  id: string;
  position: number;
  heading: string;
  blocks: LessonBlock[];
  /** What has already been written for this section, keyed by field. */
  values: Record<string, string>;
  translatedHeading: string | null;
  state: TranslationState;
}

export interface LessonTranslationView {
  lessonId: string;
  slug: string;
  locale: string;
  /** The default-locale copy, shown beside every box. */
  source: { title: string; description: string };
  /** What exists for this locale, or nulls if nobody has started. */
  translation: {
    title: string;
    description: string;
    status: "draft" | "in_review" | "published";
    stale: boolean;
  } | null;
  sections: TranslatableSection[];
}

/** Parsed, not cast: a row may predate a schema change. */
function parseBlocks(value: unknown): LessonBlock[] {
  return blocksSchema.safeParse(value).success ? (value as LessonBlock[]) : [];
}

export async function getLessonTranslation(
  slug: string,
  locale: string,
): Promise<LessonTranslationView | null> {
  const db = getDb();

  const [lesson] = await db
    .select({
      id: lessons.id,
      slug: lessons.slug,
      title: lessons.title,
      description: lessons.description,
      translatedTitle: lessonTranslations.title,
      translatedDescription: lessonTranslations.description,
      status: lessonTranslations.status,
      translationId: lessonTranslations.id,
      stale: sql<boolean>`${lessonTranslations.sourceHash} is distinct from ${lessons.sourceHash}`,
    })
    .from(lessons)
    .leftJoin(
      lessonTranslations,
      and(
        eq(lessonTranslations.lessonId, lessons.id),
        eq(lessonTranslations.locale, locale),
      ),
    )
    .where(eq(lessons.slug, slug))
    .limit(1);

  if (!lesson) return null;

  const rows = await db
    .select({
      id: lessonSections.id,
      position: lessonSections.position,
      heading: lessonSections.heading,
      body: lessonSections.body,
      translatedHeading: lessonSectionTranslations.heading,
      translatedBody: lessonSectionTranslations.body,
      status: lessonSectionTranslations.status,
      translationId: lessonSectionTranslations.id,
      stale: sql<boolean>`${lessonSectionTranslations.sourceHash} is distinct from ${lessonSections.sourceHash}`,
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
    lessonId: lesson.id,
    slug: lesson.slug,
    locale,
    source: { title: lesson.title, description: lesson.description },
    translation: lesson.translationId
      ? {
          title: lesson.translatedTitle ?? "",
          description: lesson.translatedDescription ?? "",
          status: lesson.status ?? "draft",
          stale: Boolean(lesson.stale),
        }
      : null,
    sections: rows.map((row) => {
      const blocks = parseBlocks(row.body);
      return {
        id: row.id,
        position: row.position,
        heading: row.heading,
        blocks,
        // Read against the SOURCE's field list, so a source that has since
        // gained a paragraph shows an empty box rather than dropping it.
        values: valuesFromBlocks(blocks, parseBlocks(row.translatedBody)),
        translatedHeading: row.translatedHeading,
        state: !row.translationId
          ? "missing"
          : row.status === "draft"
            ? "draft"
            : row.status === "in_review"
              ? "in_review"
              : row.stale
                ? "stale"
                : "published",
      };
    }),
  };
}

export interface LessonTranslationInput {
  title: string;
  description: string;
  sections: {
    id: string;
    heading: string;
    blocks: LessonBlock[];
  }[];
}

/**
 * Writes a translation, lesson row and sections together, in one transaction.
 *
 * One transaction because a half-saved translation is worse than an unsaved
 * one: a lesson row that says "published" over sections that were not written
 * is exactly the state the reader-side rules cannot detect.
 *
 * The status is not touched here. Saving text and deciding it is ready are
 * different acts with different permissions — see `setLessonTranslationStatus`
 * — and a save that quietly republished would let `translation:write` do what
 * `translation:review` is for.
 *
 * `source_hash` is always read back from the generated column in the same
 * statement. Never recomputed here: a second implementation of that hash is
 * how a whole catalogue silently reads as stale.
 */
export async function saveLessonTranslation(
  lessonId: string,
  locale: string,
  input: LessonTranslationInput,
): Promise<void> {
  const db = getDb();

  await db.transaction(async (tx) => {
    await tx
      .insert(lessonTranslations)
      .values({
        lessonId,
        locale,
        title: input.title,
        description: input.description,
        sourceHash: currentSourceHash(lessons, lessonId),
      })
      .onConflictDoUpdate({
        target: [lessonTranslations.lessonId, lessonTranslations.locale],
        set: {
          title: input.title,
          description: input.description,
          // Saved text is by definition made from the source as it stands, so
          // the save is also what clears "out of date". A translator who has
          // just re-read the English against their words has done the work
          // the flag was asking for.
          sourceHash: currentSourceHash(lessons, lessonId),
        },
      });

    for (const section of input.sections) {
      await tx
        .insert(lessonSectionTranslations)
        .values({
          sectionId: section.id,
          locale,
          heading: section.heading,
          body: section.blocks,
          sourceHash: currentSourceHash(lessonSections, section.id),
        })
        .onConflictDoUpdate({
          target: [
            lessonSectionTranslations.sectionId,
            lessonSectionTranslations.locale,
          ],
          set: {
            heading: section.heading,
            body: section.blocks,
            sourceHash: currentSourceHash(lessonSections, section.id),
          },
        });
    }
  });
}

/**
 * Moves a translation along its workflow, lesson and sections together.
 *
 * Together because a lesson published while its sections sit in draft would
 * serve a reader an Arabic summary over an English body, and the admin column
 * would report the worst part — leaving an editor looking at "Draft
 * translation" with a Publish button that had already been pressed.
 */
export async function setLessonTranslationStatus(
  lessonId: string,
  locale: string,
  status: "draft" | "in_review" | "published",
  reviewedBy: string | null,
): Promise<void> {
  const db = getDb();
  const reviewed =
    status === "published"
      ? { reviewedBy, reviewedAt: new Date() }
      : // Sending something back to draft clears the sign-off with it. A row
        // that says "reviewed by" while sitting in draft is a claim nobody
        // made.
        { reviewedBy: null, reviewedAt: null };

  await db.transaction(async (tx) => {
    await tx
      .update(lessonTranslations)
      .set({ status, ...reviewed })
      .where(
        and(
          eq(lessonTranslations.lessonId, lessonId),
          eq(lessonTranslations.locale, locale),
        ),
      );

    await tx
      .update(lessonSectionTranslations)
      .set({ status, ...reviewed })
      .where(
        and(
          eq(lessonSectionTranslations.locale, locale),
          sql`${lessonSectionTranslations.sectionId} in (
            select id from ${lessonSections} where lesson_id = ${lessonId}
          )`,
        ),
      );
  });
}

/** Who wrote it, recorded once — the first save owns the byline. */
export async function claimTranslator(
  lessonId: string,
  locale: string,
  userId: string,
): Promise<void> {
  await getDb()
    .update(lessonTranslations)
    .set({ translatedBy: userId })
    .where(
      and(
        eq(lessonTranslations.lessonId, lessonId),
        eq(lessonTranslations.locale, locale),
        // Only when nobody holds it. A later editor fixing a typo does not
        // take the byline from the person who did the work — and a
        // mistranslated definition should lead back to whoever wrote it.
        sql`${lessonTranslations.translatedBy} is null`,
      ),
    );
}
