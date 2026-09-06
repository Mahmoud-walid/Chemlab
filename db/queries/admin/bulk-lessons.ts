import "server-only";
import { eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { lessonSections, lessons } from "@/db/schema/content";
import type { ContentStatus } from "@/db/schema/content";
import { auditLog } from "@/db/schema/rbac";

/**
 * The database half of a bulk lesson action.
 *
 * Separate from the server action so the thing the criterion is about — one
 * transaction, one audit entry per row, all of it or none of it — can be
 * proven against real Postgres. The action itself needs `next/headers` for
 * the actor and cannot run in the integration suite; this can.
 */

export interface BulkLessonRow {
  id: string;
  label: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  status: ContentStatus;
  publishedAt: Date | null;
  deletedAt: Date | null;
  sectionCount: number;
}

/** Everything a bulk decision needs, for the selected ids only. */
export async function lessonsForBulk(ids: string[]): Promise<BulkLessonRow[]> {
  if (ids.length === 0) return [];

  return getDb()
    .select({
      id: lessons.id,
      // The name an operator would read aloud, for the refusal message. An id
      // in an error is a puzzle.
      label: lessons.title,
      slug: lessons.slug,
      title: lessons.title,
      description: lessons.description,
      category: lessons.category,
      status: lessons.status,
      publishedAt: lessons.publishedAt,
      deletedAt: lessons.deletedAt,
      // Qualified explicitly: drizzle renders columns unqualified inside a
      // `sql` subquery, so an unqualified `"id"` binds to the INNER table and
      // counts zero for every lesson, silently.
      sectionCount: sql<number>`(
        select count(*)::int from ${lessonSections}
        where ${lessonSections}."lesson_id" = ${lessons}."id"
      )`,
    })
    .from(lessons)
    .where(inArray(lessons.id, [...new Set(ids)]));
}

export type BulkLessonAction = "publish" | "archive" | "withdraw";

/**
 * Writes the batch.
 *
 * One transaction, so a failure part-way leaves nothing behind — the state
 * this guards against is forty lessons of which nineteen were archived and
 * nobody knows which.
 *
 * One audit entry per row, not one for the batch. "Somebody archived forty
 * lessons" is not an answer to "who archived THIS lesson", and the log is
 * read one row at a time.
 */
export async function applyBulkLessons(
  actorId: string,
  rows: BulkLessonRow[],
  action: BulkLessonAction,
  now = new Date(),
): Promise<void> {
  if (rows.length === 0) return;

  const status: ContentStatus = action === "publish" ? "published" : "archived";

  await getDb().transaction(async (tx) => {
    for (const row of rows) {
      await tx
        .update(lessons)
        .set({
          status,
          ...(action === "withdraw" ? { deletedAt: now } : {}),
          publishedAt:
            action === "publish" && row.publishedAt === null
              ? now
              : row.publishedAt,
        })
        .where(eq(lessons.id, row.id));

      await tx.insert(auditLog).values({
        actorId,
        action: action === "withdraw" ? "lesson.delete" : `lesson.${status}`,
        targetType: "lesson",
        targetId: row.id,
        before: { status: row.status, deletedAt: row.deletedAt },
        after: {
          status,
          deletedAt: action === "withdraw" ? now.toISOString() : row.deletedAt,
          // So the log can tell a batch from forty deliberate single actions.
          bulk: true,
        },
      });
    }
  });
}
