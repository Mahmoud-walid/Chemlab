import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { getDb } from "@/db/client";
import { lessonSections, lessons } from "@/db/schema/content";
import { blocksSchema, type LessonBlock } from "@/lib/lessons/blocks";
import { readingTimeSeconds } from "@/lib/lessons/reading-time";

/**
 * Reading and writing a lesson's sections, for the editor.
 *
 * The write is a whole-body replace inside one transaction, not a per-section
 * diff. A section can be added, removed, reordered and retitled in one editing
 * session, and reconstructing which is which from a diff is guesswork that
 * gets a translation attached to the wrong paragraph. Block ids are what
 * survive, and they travel inside the bodies.
 */

export interface EditableSection {
  id: string;
  position: number;
  heading: string;
  blocks: LessonBlock[];
}

export async function getEditableSections(
  lessonId: string,
): Promise<EditableSection[]> {
  const rows = await getDb()
    .select({
      id: lessonSections.id,
      position: lessonSections.position,
      heading: lessonSections.heading,
      body: lessonSections.body,
    })
    .from(lessonSections)
    .where(eq(lessonSections.lessonId, lessonId))
    .orderBy(asc(lessonSections.position));

  return rows.map((row) => ({
    id: row.id,
    position: row.position,
    heading: row.heading,
    // Parsed, not cast: the column is jsonb and the row may predate a schema
    // change. Loading an unrenderable block into the editor and saving it back
    // would launder it into the table as though it were valid.
    blocks: blocksSchema.safeParse(row.body).success
      ? (row.body as LessonBlock[])
      : [],
  }));
}

export interface SectionInput {
  heading: string;
  blocks: LessonBlock[];
}

export interface SaveSectionsResult {
  readingTimeSeconds: number;
  revision: number;
  sections: number;
}

/**
 * Replaces the body, recomputes the reading time and bumps the revision.
 *
 * All three in ONE transaction. A reading time that belongs to a body that was
 * never committed is worse than a stale one, and a revision that did not move
 * would leave every translation looking current against a body that changed.
 */
export async function saveSections(
  lessonId: string,
  sections: SectionInput[],
): Promise<SaveSectionsResult> {
  const db = getDb();

  // Validated here as well as in the action. This function is the last thing
  // between an editor's document and the column, and the column is read by a
  // page that cannot check.
  const validated = sections.map((section) => ({
    heading: section.heading.trim(),
    blocks: blocksSchema.parse(section.blocks),
  }));

  const seconds = readingTimeSeconds(
    validated.flatMap((section) => section.blocks),
  );

  return db.transaction(async (tx) => {
    await tx
      .delete(lessonSections)
      .where(eq(lessonSections.lessonId, lessonId));

    if (validated.length > 0) {
      await tx.insert(lessonSections).values(
        validated.map((section, index) => ({
          id: uuidv7(),
          lessonId,
          position: index,
          heading: section.heading,
          body: section.blocks,
        })),
      );
    }

    const [row] = await tx
      .select({ revision: lessons.revision })
      .from(lessons)
      .where(eq(lessons.id, lessonId));

    const revision = (row?.revision ?? 1) + 1;

    await tx
      .update(lessons)
      .set({
        readingTimeSeconds: seconds,
        revision,
        updatedAt: new Date(),
      })
      .where(eq(lessons.id, lessonId));

    return {
      readingTimeSeconds: seconds,
      revision,
      sections: validated.length,
    };
  });
}

/** The lesson id behind a slug, for the editor route. Includes drafts — an
 * editor must be able to open a lesson that is not published yet. */
export async function editableLessonId(slug: string): Promise<string | null> {
  const [lesson] = await getDb()
    .select({ id: lessons.id })
    .from(lessons)
    .where(and(eq(lessons.slug, slug)))
    .limit(1);
  return lesson?.id ?? null;
}
