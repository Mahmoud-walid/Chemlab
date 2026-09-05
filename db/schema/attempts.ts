import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { id, timestamps } from "./_shared";
import { quizQuestions, quizzes } from "./content";
import { users } from "./auth";

/**
 * Sittings of a quiz.
 *
 * The engine this table exists for replaces a client-side toy: today the quiz
 * page imports `data/quiz.json` — every answer and explanation — into the
 * browser bundle, scores in JavaScript, and writes the result to
 * `sessionStorage`. Anyone can read the answer key from devtools and anyone
 * can forge a score. Nothing here trusts the client with either.
 *
 * Built on `quizzes` and `quiz_questions` rather than the new `exams` tables
 * #26 sketched: those already exist, already carry the sitting rules, and
 * already have an admin UI. Two content models for one concept is how a
 * product ends up with two half-working exam screens.
 */

export const attemptStatus = pgEnum("attempt_status", [
  "in_progress",
  "submitted",
  // Ran out of time. Distinct from `abandoned`: an expired attempt was scored
  // on whatever was saved, and the candidate is owed that score.
  "expired",
  "abandoned",
  // Struck out by an administrator, with a reason. Kept rather than deleted —
  // "this attempt does not count, and here is why" is a different fact from
  // "this attempt never happened".
  "voided",
]);

export const examAttempts = pgTable(
  "exam_attempts",
  {
    id: id(),
    quizId: uuid("quiz_id")
      .notNull()
      .references(() => quizzes.id, { onDelete: "cascade" }),
    // `text`, not `uuid`: Better Auth owns the users table and generates its
    // own string ids. The rest of this schema uses UUID v7, but a foreign key
    // has to match the column it points at.
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 1-based, per user per quiz. Enforced by a unique index, not by a count. */
    attemptNumber: integer("attempt_number").notNull(),
    /**
     * Drives Fisher–Yates for the question and option order.
     *
     * The seed is stored, not the permutation. Three integers regenerate the
     * exact paper on any device, in any process, and — unlike a stored array
     * of ids — the seed does not go stale when a question is deleted.
     */
    seed: integer("seed").notNull(),
    /**
     * The quiz's `updated_at` when the attempt started.
     *
     * A quiz edited mid-attempt is still scored against what the candidate
     * actually saw. Re-scoring an attempt against questions nobody was shown
     * is not a fix for anything.
     */
    quizRevision: timestamp("quiz_revision", { withTimezone: true }).notNull(),
    status: attemptStatus("status").notNull().default("in_progress"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Computed SERVER-side at start from the quiz's time limit. The client
     * never sends a duration, and never gets to move this.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    score: integer("score"),
    maxScore: integer("max_score"),
    passed: boolean("passed"),
    voidReason: text("void_reason"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("exam_attempts_number_idx").on(
      t.quizId,
      t.userId,
      t.attemptNumber,
    ),
    /**
     * At most one live attempt per person per quiz — as a partial unique
     * index, so it holds under concurrency.
     *
     * A `select count(*)` before insert loses the race between two tabs
     * pressing Start at the same moment; the index cannot. It is also what
     * makes the expiry sweep necessary: an attempt left `in_progress` by a
     * closed laptop would otherwise block every future sitting.
     */
    uniqueIndex("exam_attempts_one_live_idx")
      .on(t.quizId, t.userId)
      .where(sql`status = 'in_progress'`),
    index("exam_attempts_user_idx").on(t.userId, t.createdAt),
    index("exam_attempts_quiz_idx").on(t.quizId, t.status),
  ],
);

export const attemptAnswers = pgTable(
  "attempt_answers",
  {
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => examAttempts.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => quizQuestions.id, { onDelete: "cascade" }),
    /**
     * An array even for single choice, so adding multiple choice is not a
     * change to the answer representation — and so "answered nothing" is an
     * empty array rather than a null that every reader has to remember.
     */
    selectedOptionIds: jsonb("selected_option_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /**
     * Written by the SERVER at scoring time, never accepted from a client.
     * Null while the attempt is in progress: nothing has been marked yet.
     */
    isCorrect: boolean("is_correct"),
    pointsAwarded: integer("points_awarded"),
    answeredAt: timestamp("answered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Client-reported, and used for analytics ONLY — never for grading. A
     * number the candidate's browser chose cannot decide the candidate's mark.
     */
    timeSpentMs: integer("time_spent_ms"),
  },
  (t) => [primaryKey({ columns: [t.attemptId, t.questionId] })],
);
