import "server-only";
import { and, eq, notInArray, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

import { quizOptions, quizQuestions } from "@/db/schema/content";
import type * as schema from "@/db/schema";
import type { QuestionInput } from "@/lib/admin/quiz-schema";

/**
 * Whatever can run these writes: a transaction handle, or a plain client.
 *
 * `PgTransaction` extends `PgDatabase`, so one type covers the action (which
 * passes its `tx`) and the tests (which pass a connection directly). Callers
 * that mutate should still wrap this in a transaction — the reordering leaves
 * rows at negative positions partway through.
 */
export type QuestionWriter = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * Replaces a quiz's questions with the given list, inside a caller-supplied
 * transaction.
 *
 * Separated from the server action deliberately. The action owns the
 * permission check, the audit entry and revalidation; this owns the SQL — and
 * this is the part with the sharp edges, so it needs to be callable from a
 * test that has a database but no request.
 *
 * Ordering: positions are rewritten to a contiguous 0..n-1 sequence from the
 * list order. Because (quiz_id, position) is unique, the surviving rows are
 * first parked at negative positions — assigning the new numbers directly
 * would collide with rows that still hold them, and Postgres checks a plain
 * unique index per statement rather than at commit.
 *
 * The correct answer is written LAST, once the options exist: it is a
 * reference, and pointing it at a row that has not been written yet is how a
 * question becomes unanswerable.
 */
export async function replaceQuizQuestions(
  db: QuestionWriter,
  quizId: string,
  questions: QuestionInput[],
): Promise<void> {
  const keptIds = questions
    .map((question) => question.id)
    .filter((id): id is string => Boolean(id));

  // Questions the author removed. Cascades to their options.
  await db
    .delete(quizQuestions)
    .where(
      keptIds.length > 0
        ? and(
            eq(quizQuestions.quizId, quizId),
            notInArray(quizQuestions.id, keptIds),
          )
        : eq(quizQuestions.quizId, quizId),
    );

  // Park the survivors out of the way of the numbers about to be assigned.
  if (keptIds.length > 0) {
    await db
      .update(quizQuestions)
      .set({ position: sql`-1 - ${quizQuestions.position}` })
      .where(eq(quizQuestions.quizId, quizId));
  }

  for (const [position, question] of questions.entries()) {
    const questionId = question.id ?? uuidv7();

    if (question.id) {
      await db
        .update(quizQuestions)
        .set({
          prompt: question.prompt,
          explanation: question.explanation,
          points: question.points,
          position,
        })
        .where(eq(quizQuestions.id, questionId));
    } else {
      await db.insert(quizQuestions).values({
        id: questionId,
        quizId,
        position,
        prompt: question.prompt,
        explanation: question.explanation,
        points: question.points,
      });
    }

    const keptOptionIds = question.options
      .map((option) => option.id)
      .filter((id): id is string => Boolean(id));

    await db
      .delete(quizOptions)
      .where(
        keptOptionIds.length > 0
          ? and(
              eq(quizOptions.questionId, questionId),
              notInArray(quizOptions.id, keptOptionIds),
            )
          : eq(quizOptions.questionId, questionId),
      );

    if (keptOptionIds.length > 0) {
      await db
        .update(quizOptions)
        .set({ position: sql`-1 - ${quizOptions.position}` })
        .where(eq(quizOptions.questionId, questionId));
    }

    const optionIds: string[] = [];
    for (const [optionPosition, option] of question.options.entries()) {
      const optionId = option.id ?? uuidv7();
      optionIds.push(optionId);

      if (option.id) {
        await db
          .update(quizOptions)
          .set({ label: option.label, position: optionPosition })
          .where(eq(quizOptions.id, optionId));
      } else {
        await db.insert(quizOptions).values({
          id: optionId,
          questionId,
          position: optionPosition,
          label: option.label,
        });
      }
    }

    await db
      .update(quizQuestions)
      .set({ correctOptionId: optionIds[question.correctIndex] ?? null })
      .where(eq(quizQuestions.id, questionId));
  }
}
