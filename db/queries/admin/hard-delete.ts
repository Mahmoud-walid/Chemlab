import "server-only";
import { and, count, eq, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { activityEvents } from "@/db/schema/activity";
import { comments } from "@/db/schema/comments";
import { examAttempts } from "@/db/schema/attempts";
import { lessons, quizQuestions, quizzes } from "@/db/schema/content";
import { lessonLikes, lessonSaves } from "@/db/schema/engagement";
import { auditLog } from "@/db/schema/rbac";
import type { HardDeleteState } from "@/lib/admin/hard-delete";

/**
 * Erasing a row, and deciding whether that is allowed.
 *
 * Two resources, one decision. The rules live in `lib/admin/hard-delete.ts`
 * and are shared; what differs is which counts each resource has to take, and
 * for both of them some of the six are structurally zero. Those stay in the
 * shape as literals rather than being dropped, so the decision stays in one
 * function instead of being re-derived by every caller.
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
      // Lessons are not sat: `exam_attempts` holds a `quiz_id` and nothing
      // else. Unreachable by construction, like `comments` and `engagement`
      // on the quiz side below — not an unchecked reason.
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

/* ------------------------------------------------------------- quizzes --- */

export interface QuizHardDeleteState extends HardDeleteState {
  id: string;
  slug: string;
  title: string;
}

/**
 * The same decision for a quiz, and the counts are NOT the lesson's.
 *
 * Two of the six reasons are structurally unreachable here, and saying so is
 * better than leaving a reader to wonder whether they were forgotten:
 *
 * - `comment_subject` is a Postgres enum whose only value is `'lesson'`. A
 *   comment on a quiz cannot be inserted, so the count cannot be non-zero.
 * - `lesson_saves`, `lesson_likes` and `share_events` all hold a `lesson_id`.
 *   There is no quiz engagement to count.
 *
 * They stay in the shape as literal zeroes rather than being dropped from it,
 * for the same reason `attempts` was a literal zero on the lesson side: one
 * `HardDeleteState` serves both resources, and a missing field would move the
 * decision out of `hardDeleteRefusals` and into each caller. If quizzes ever
 * become commentable, this is the one place that changes.
 *
 * `attempts` is the reason this path exists at all. A quiz somebody has sat is
 * not a mistake — it is a result, and results get withdrawn, not erased.
 */
export async function quizHardDeleteState(
  id: string,
): Promise<QuizHardDeleteState | null> {
  const [row] = await getDb()
    .select({
      id: quizzes.id,
      slug: quizzes.slug,
      title: quizzes.title,
      status: quizzes.status,
      publishedAt: quizzes.publishedAt,
      // See above: unreachable by construction, not unchecked.
      comments: sql<number>`0`,
      engagement: sql<number>`0`,
      activity: sql<number>`(
        select count(*)::int from ${activityEvents}
        where ${activityEvents}."object_type" = 'quiz'
          and ${activityEvents}."object_id" = ${quizzes}."id"::text
      )`,
      // Every attempt, whatever its status: an abandoned sitting is still
      // somebody having seen the paper, and `exam_attempts` cascades — so
      // erasing the quiz would take the evidence with it.
      attempts: sql<number>`(
        select count(*)::int from ${examAttempts}
        where ${examAttempts}."quiz_id" = ${quizzes}."id"
      )`,
    })
    .from(quizzes)
    .where(eq(quizzes.id, id))
    .limit(1);

  return row ?? null;
}

/**
 * Erases the quiz, after writing what it was.
 *
 * Everything said about the lesson version applies: the audit entry goes in
 * FIRST, inside the same transaction, and `before` carries the slug and title
 * because an id pointing at nothing is not an answer to "what was deleted".
 *
 * The cascade is wider here. `quiz_questions`, `quiz_options`, both
 * translation tables and `exam_attempts` all reference the quiz with
 * `on delete cascade`, so this statement removes a subtree rather than a row.
 * That is why `questionCount` is recorded: the audit entry is the only
 * remaining evidence of how much was erased, and "a quiz" understates it.
 *
 * The guard in the WHERE clause is the check that cannot be raced. The state
 * was read before the operator typed a confirmation, and an attempt can start
 * in between — a quiz cannot be sat while it is a draft, but it can be
 * published by somebody else in the same window, which is exactly what the
 * status and `published_at` conditions refuse.
 */
export async function hardDeleteQuiz(
  actorId: string,
  row: QuizHardDeleteState,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    const [counted] = await tx
      .select({ questions: count() })
      .from(quizQuestions)
      .where(eq(quizQuestions.quizId, row.id));

    await tx.insert(auditLog).values({
      actorId,
      action: "quiz.delete_hard",
      targetType: "quiz",
      targetId: row.id,
      before: {
        slug: row.slug,
        title: row.title,
        status: row.status,
        publishedAt: row.publishedAt?.toISOString() ?? null,
        // How much went with it. See above.
        questionCount: Number(counted?.questions ?? 0),
      },
      after: null,
    });

    const result = await tx
      .delete(quizzes)
      .where(
        and(
          eq(quizzes.id, row.id),
          eq(quizzes.status, "draft"),
          sql`${quizzes.publishedAt} is null`,
        ),
      );

    if ((result.rowCount ?? 0) === 0) {
      // Rolls back the audit entry with it. A log saying a quiz was erased
      // when it was not is worse than no log.
      throw new Error("The quiz changed before it could be deleted.");
    }
  });
}
