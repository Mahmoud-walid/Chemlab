import "server-only";
import { eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { quizOptions, quizQuestions, quizzes } from "@/db/schema/content";
import type { ContentStatus } from "@/db/schema/content";
import { auditLog } from "@/db/schema/rbac";

/**
 * The database half of a bulk quiz action.
 *
 * The lesson twin of this file (`bulk-lessons.ts`) explains why it is separate
 * from the server action: the criterion — one transaction, one audit entry per
 * row, all of it or none of it — can only be proven against real Postgres, and
 * the action needs `next/headers` for the actor so it cannot run in the
 * integration suite. This can.
 *
 * What is NOT shared with lessons is the publish decision. A lesson needs
 * sections; a quiz needs questions, and questions somebody can actually
 * answer. Both counts come back per row so `quizPublishBlockers` can be
 * applied to a batch with exactly the keys the single-row path uses.
 */

export interface BulkQuizRow {
  id: string;
  label: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  status: ContentStatus;
  publishedAt: Date | null;
  deletedAt: Date | null;
  questionCount: number;
  /** Questions whose `correct_option_id` resolves to nothing. */
  unanswerableCount: number;
}

/**
 * Everything a bulk decision needs, for the selected ids only.
 *
 * One query, not one per quiz. `quizPublishCounts` answers the same question
 * for a single quiz with an aggregate; a batch needs it correlated per row, so
 * the same two counts appear here as subqueries.
 *
 * Both are qualified explicitly. Drizzle renders columns unqualified inside a
 * `sql` subquery, so an unqualified `"id"` binds to the INNER table — for the
 * lesson version that silently counted zero sections for every row, and here
 * it would silently report every quiz as having no questions, i.e. refuse
 * every bulk publish with a blocker that is not true.
 */
export async function quizzesForBulk(ids: string[]): Promise<BulkQuizRow[]> {
  if (ids.length === 0) return [];

  return getDb()
    .select({
      id: quizzes.id,
      // The name an operator would read aloud, for the refusal message. An id
      // in an error is a puzzle.
      label: quizzes.title,
      slug: quizzes.slug,
      title: quizzes.title,
      description: quizzes.description,
      category: quizzes.category,
      status: quizzes.status,
      publishedAt: quizzes.publishedAt,
      deletedAt: quizzes.deletedAt,
      questionCount: sql<number>`(
        select count(*)::int from ${quizQuestions}
        where ${quizQuestions}."quiz_id" = ${quizzes}."id"
      )`,
      // A question is unanswerable when its correct option is null, or when it
      // points at an option that no longer exists — the FK is nullable, so the
      // second case is reachable. Same rule as `quizPublishCounts`.
      unanswerableCount: sql<number>`(
        select count(*)::int from ${quizQuestions}
        where ${quizQuestions}."quiz_id" = ${quizzes}."id"
          and (
            ${quizQuestions}."correct_option_id" is null
            or not exists (
              select 1 from ${quizOptions}
              where ${quizOptions}."id" = ${quizQuestions}."correct_option_id"
            )
          )
      )`,
    })
    .from(quizzes)
    .where(inArray(quizzes.id, [...new Set(ids)]));
}

export type BulkQuizAction = "publish" | "archive" | "withdraw";

/**
 * Writes the batch.
 *
 * One transaction, so a failure part-way leaves nothing behind — the state
 * this guards against is forty quizzes of which nineteen were archived and
 * nobody knows which.
 *
 * One audit entry per row, not one for the batch. "Somebody archived forty
 * quizzes" is not an answer to "who archived THIS quiz", and the log is read
 * one row at a time.
 */
export async function applyBulkQuizzes(
  actorId: string,
  rows: BulkQuizRow[],
  action: BulkQuizAction,
  now = new Date(),
): Promise<void> {
  if (rows.length === 0) return;

  const status: ContentStatus = action === "publish" ? "published" : "archived";

  await getDb().transaction(async (tx) => {
    for (const row of rows) {
      await tx
        .update(quizzes)
        .set({
          status,
          ...(action === "withdraw" ? { deletedAt: now } : {}),
          // Written once, the first time it goes live, and never cleared —
          // the same rule `setQuizStatus` applies to a single row.
          publishedAt:
            action === "publish" && row.publishedAt === null
              ? now
              : row.publishedAt,
        })
        .where(eq(quizzes.id, row.id));

      await tx.insert(auditLog).values({
        actorId,
        action: action === "withdraw" ? "quiz.delete" : `quiz.${status}`,
        targetType: "quiz",
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
