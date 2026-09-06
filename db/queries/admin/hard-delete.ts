import "server-only";
import { and, eq, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { activityEvents } from "@/db/schema/activity";
import { comments } from "@/db/schema/comments";
import { lessons } from "@/db/schema/content";
import { lessonLikes, lessonSaves } from "@/db/schema/engagement";
import { auditLog } from "@/db/schema/rbac";
import type { HardDeleteState } from "@/lib/admin/hard-delete";

/**
 * Erasing a lesson, and deciding whether that is allowed.
 *
 * The counts are taken in ONE query. Four round trips would leave four
 * windows in which a comment can arrive between the check and the delete;
 * one still leaves a window, which is why the delete re-checks inside its own
 * transaction rather than trusting what the screen was rendered from.
 */

export interface LessonHardDeleteState extends HardDeleteState {
  id: string;
  slug: string;
  title: string;
}

export async function lessonHardDeleteState(
  id: string,
): Promise<LessonHardDeleteState | null> {
  const [row] = await getDb()
    .select({
      id: lessons.id,
      slug: lessons.slug,
      title: lessons.title,
      status: lessons.status,
      publishedAt: lessons.publishedAt,
      comments: sql<number>`(
        select count(*)::int from ${comments}
        where ${comments}."subject_type" = 'lesson'
          and ${comments}."subject_id" = ${lessons}."id"
      )`,
      // Likes and saves together: they are the same question — has anybody
      // kept this? — and telling them apart would not change the answer.
      engagement: sql<number>`(
        (select count(*)::int from ${lessonSaves}
          where ${lessonSaves}."lesson_id" = ${lessons}."id")
        + (select count(*)::int from ${lessonLikes}
          where ${lessonLikes}."lesson_id" = ${lessons}."id")
      )`,
      activity: sql<number>`(
        select count(*)::int from ${activityEvents}
        where ${activityEvents}."object_type" = 'lesson'
          and ${activityEvents}."object_id" = ${lessons}."id"::text
      )`,
      // Lessons are not sat. The column exists so one shape serves both
      // resources when quizzes gain this path.
      attempts: sql<number>`0`,
    })
    .from(lessons)
    .where(eq(lessons.id, id))
    .limit(1);

  return row ?? null;
}

/**
 * Erases the row, after writing what it was.
 *
 * The audit entry goes in FIRST, inside the same transaction. `audit_log`
 * holds no foreign key to the row it describes, so the entry survives it —
 * which is the whole point: the only remaining record that this lesson ever
 * existed is the one written here. Writing it afterwards would leave a window
 * in which the row is gone and nothing says so.
 *
 * `before` therefore carries the slug and title, not just the id. An id
 * pointing at nothing is not an answer to "what was deleted".
 */
export async function hardDeleteLesson(
  actorId: string,
  row: LessonHardDeleteState,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.insert(auditLog).values({
      actorId,
      action: "lesson.delete_hard",
      targetType: "lesson",
      targetId: row.id,
      before: {
        slug: row.slug,
        title: row.title,
        status: row.status,
        publishedAt: row.publishedAt?.toISOString() ?? null,
      },
      after: null,
    });

    // Guarded inside the transaction: the state was read before the operator
    // typed a confirmation, and a comment can arrive in between. The WHERE
    // clause is the check that cannot be raced — it deletes only a row that
    // is still a draft that was never published.
    const result = await tx
      .delete(lessons)
      .where(
        and(
          eq(lessons.id, row.id),
          eq(lessons.status, "draft"),
          sql`${lessons.publishedAt} is null`,
        ),
      );

    if ((result.rowCount ?? 0) === 0) {
      // Rolls back the audit entry with it. A log saying a lesson was erased
      // when it was not is worse than no log.
      throw new Error("The lesson changed before it could be deleted.");
    }
  });
}
