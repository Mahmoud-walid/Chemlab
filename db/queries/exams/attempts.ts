import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { uuidv7 } from "uuidv7";

import { getDb } from "@/db/client";
import { attemptAnswers, examAttempts } from "@/db/schema/attempts";
import { quizOptions, quizQuestions, quizzes } from "@/db/schema/content";
import { newSeed, optionSeed, shuffleWithSeed } from "@/lib/exams/shuffle";
import { scoreAttempt, type ScorableQuestion } from "@/lib/exams/score";

/**
 * The exam engine's server half.
 *
 * Everything the client is not allowed to decide lives here: the clock, the
 * question order, whether an attempt may be started at all, and the score.
 * The quiz page this replaces did all four in the browser — it imported the
 * whole answer key into the bundle, counted correct answers in JavaScript, and
 * wrote the result to `sessionStorage`, where the candidate could edit it.
 *
 * The rule that shapes every function below: **a value the client sent is
 * input, never authority.**
 */

// ── What the candidate is allowed to see ────────────────────────────────────

export interface PaperOption {
  id: string;
  label: string;
}

export interface PaperQuestion {
  id: string;
  /** Position in THIS attempt's order, not in the quiz. */
  position: number;
  type: "single_choice" | "multiple_choice";
  prompt: string;
  points: number;
  options: PaperOption[];
  /** What this candidate has saved so far. */
  selectedOptionIds: string[];
}

export interface Paper {
  attemptId: string;
  quizSlug: string;
  quizTitle: string;
  attemptNumber: number;
  status: string;
  startedAt: Date;
  /** Absolute, server-computed. Null on an untimed quiz. */
  expiresAt: Date | null;
  /**
   * The server's clock at the moment this was read.
   *
   * Sent so the client can compute an offset ONCE and render a countdown from
   * it. The countdown is decoration: a tab's `setTimeout` can be paused in
   * devtools, throttled to once a minute in the background, or simply never
   * fired, and a disconnected client cannot enforce anything at all.
   */
  serverNow: Date;
  questions: PaperQuestion[];
}

/**
 * The in-progress paper.
 *
 * Every column is named explicitly. That is the whole defence: shipping the
 * answer key now requires somebody to ADD `quizOptions.isCorrect` or
 * `quizQuestions.explanation` to a select list by name, rather than merely
 * forgetting to strip it from a `select *`. `tests/integration/exam-attempt`
 * asserts the serialised result contains neither.
 */
export async function getPaper(
  attemptId: string,
  userId: string,
): Promise<Paper | null> {
  const db = getDb();

  const [attempt] = await db
    .select({
      id: examAttempts.id,
      quizId: examAttempts.quizId,
      userId: examAttempts.userId,
      attemptNumber: examAttempts.attemptNumber,
      seed: examAttempts.seed,
      status: examAttempts.status,
      startedAt: examAttempts.startedAt,
      expiresAt: examAttempts.expiresAt,
      quizSlug: quizzes.slug,
      quizTitle: quizzes.title,
      shuffleQuestions: quizzes.shuffleQuestions,
      shuffleOptions: quizzes.shuffleOptions,
    })
    .from(examAttempts)
    .innerJoin(quizzes, eq(quizzes.id, examAttempts.quizId))
    .where(eq(examAttempts.id, attemptId));

  // Ownership is checked here rather than by the caller: an attempt id is a
  // UUID, but "unguessable" is not an authorization model.
  if (!attempt || attempt.userId !== userId) return null;

  const questionRows = await db
    .select({
      id: quizQuestions.id,
      position: quizQuestions.position,
      type: quizQuestions.type,
      prompt: quizQuestions.prompt,
      points: quizQuestions.points,
      // NOT `explanation`. NOT `correctOptionId`.
    })
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, attempt.quizId))
    .orderBy(asc(quizQuestions.position));

  const optionRows = questionRows.length
    ? await db
        .select({
          id: quizOptions.id,
          questionId: quizOptions.questionId,
          position: quizOptions.position,
          label: quizOptions.label,
          // NOT `isCorrect`.
        })
        .from(quizOptions)
        .where(
          inArray(
            quizOptions.questionId,
            questionRows.map((q) => q.id),
          ),
        )
        .orderBy(asc(quizOptions.position))
    : [];

  const saved = await db
    .select({
      questionId: attemptAnswers.questionId,
      selectedOptionIds: attemptAnswers.selectedOptionIds,
    })
    .from(attemptAnswers)
    .where(eq(attemptAnswers.attemptId, attempt.id));
  const savedByQuestion = new Map(
    saved.map((row) => [row.questionId, row.selectedOptionIds]),
  );

  const ordered = attempt.shuffleQuestions
    ? shuffleWithSeed(questionRows, attempt.seed)
    : questionRows;

  const questions: PaperQuestion[] = ordered.map((question, index) => {
    const options = optionRows.filter(
      (option) => option.questionId === question.id,
    );
    return {
      id: question.id,
      position: index,
      type: question.type,
      prompt: question.prompt,
      points: question.points,
      options: (attempt.shuffleOptions
        ? // Seeded from the question's position in THIS paper, so two
          // questions do not receive the same permutation — otherwise
          // noticing where one answer moved would reveal where the rest did.
          shuffleWithSeed(options, optionSeed(attempt.seed, index))
        : options
      ).map((option) => ({ id: option.id, label: option.label })),
      selectedOptionIds: savedByQuestion.get(question.id) ?? [],
    };
  });

  return {
    attemptId: attempt.id,
    quizSlug: attempt.quizSlug,
    quizTitle: attempt.quizTitle,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    serverNow: new Date(),
    questions,
  };
}

// ── Starting ────────────────────────────────────────────────────────────────

export type StartResult =
  | { ok: true; attemptId: string; resumed: boolean }
  | {
      ok: false;
      reason: "not_found" | "attempts_exhausted" | "cooling_down";
      /** When `cooling_down`, the moment the next attempt becomes available. */
      availableAt?: Date;
    };

/**
 * Starts a sitting, or returns the one already in progress.
 *
 * Resuming rather than refusing is deliberate: a candidate who refreshed, lost
 * their connection or closed the laptop has one live attempt, and the honest
 * behaviour is to hand it back with its real remaining time — not to tell them
 * they already have an attempt open and leave them no way to reach it.
 */
export async function startAttempt(
  quizSlug: string,
  userId: string,
): Promise<StartResult> {
  const db = getDb();

  const [quiz] = await db
    .select({
      id: quizzes.id,
      updatedAt: quizzes.updatedAt,
      timeLimitSeconds: quizzes.timeLimitSeconds,
      maxAttempts: quizzes.maxAttempts,
      cooldownMinutes: quizzes.cooldownMinutes,
      status: quizzes.status,
    })
    .from(quizzes)
    .where(
      and(
        eq(quizzes.slug, quizSlug),
        eq(quizzes.status, "published"),
        isNull(quizzes.deletedAt),
      ),
    );

  if (!quiz) return { ok: false, reason: "not_found" };

  // The sweep runs first so an attempt abandoned on a closed laptop does not
  // masquerade as this candidate's live sitting and block a new one.
  await sweepExpiredAttempts(quiz.id, userId);

  const previous = await db
    .select({
      id: examAttempts.id,
      status: examAttempts.status,
      attemptNumber: examAttempts.attemptNumber,
      submittedAt: examAttempts.submittedAt,
    })
    .from(examAttempts)
    .where(
      and(eq(examAttempts.quizId, quiz.id), eq(examAttempts.userId, userId)),
    )
    .orderBy(desc(examAttempts.attemptNumber));

  const live = previous.find((attempt) => attempt.status === "in_progress");
  if (live) return { ok: true, attemptId: live.id, resumed: true };

  // A voided attempt still counts as a sitting: it happened, and letting a
  // void hand back an extra go turns the sanction into a reward.
  if (quiz.maxAttempts !== null && previous.length >= quiz.maxAttempts) {
    return { ok: false, reason: "attempts_exhausted" };
  }

  if (quiz.cooldownMinutes > 0) {
    const last = previous
      .map((attempt) => attempt.submittedAt)
      .filter((at): at is Date => at !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    if (last) {
      const availableAt = new Date(
        last.getTime() + quiz.cooldownMinutes * 60_000,
      );
      if (availableAt > new Date()) {
        return { ok: false, reason: "cooling_down", availableAt };
      }
    }
  }

  const startedAt = new Date();
  // The id is generated here rather than read back with `.returning()`: the
  // union of the two drivers `getDb()` can return does not agree on that
  // method's signature, and UUID v7 is generated in application code anyway.
  const attemptId = uuidv7();
  await db.insert(examAttempts).values({
    id: attemptId,
    quizId: quiz.id,
    userId,
    attemptNumber: (previous[0]?.attemptNumber ?? 0) + 1,
    seed: newSeed(),
    // What the candidate is about to be shown. A quiz edited mid-sitting is
    // still scored against this.
    quizRevision: quiz.updatedAt,
    startedAt,
    // The server computes the deadline. The client never sends a duration,
    // and there is no code path where it could.
    expiresAt:
      quiz.timeLimitSeconds === null
        ? null
        : new Date(startedAt.getTime() + quiz.timeLimitSeconds * 1000),
  });

  return { ok: true, attemptId, resumed: false };
}

// ── The deadline ────────────────────────────────────────────────────────────

/**
 * Whether a write arriving now is still in time.
 *
 * `graceSeconds` covers real network latency and clock skew, so an honest
 * answer sent at T-1s is not lost to a 400ms round trip. It is a server-side
 * constant per quiz — a client-supplied grace period is not a grace period.
 */
export function isWithinDeadline(
  expiresAt: Date | null,
  graceSeconds: number,
  now: Date = new Date(),
): boolean {
  if (expiresAt === null) return true;
  return now.getTime() <= expiresAt.getTime() + graceSeconds * 1000;
}

export type SaveResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_found" | "not_live" | "expired" | "unknown_option";
    };

/**
 * Saves one answer, incrementally, so a crash loses at most one question.
 *
 * Re-checked against the server clock on every call rather than once at
 * submit: an attempt whose deadline passed twenty minutes ago must not be able
 * to keep writing answers because nobody has looked at it since.
 */
export async function saveAnswer(
  attemptId: string,
  userId: string,
  questionId: string,
  selectedOptionIds: string[],
  timeSpentMs?: number,
): Promise<SaveResult> {
  const db = getDb();

  const [attempt] = await db
    .select({
      id: examAttempts.id,
      userId: examAttempts.userId,
      quizId: examAttempts.quizId,
      status: examAttempts.status,
      expiresAt: examAttempts.expiresAt,
      graceSeconds: quizzes.graceSeconds,
    })
    .from(examAttempts)
    .innerJoin(quizzes, eq(quizzes.id, examAttempts.quizId))
    .where(eq(examAttempts.id, attemptId));

  if (!attempt || attempt.userId !== userId)
    return { ok: false, reason: "not_found" };
  if (attempt.status !== "in_progress")
    return { ok: false, reason: "not_live" };

  if (!isWithinDeadline(attempt.expiresAt, attempt.graceSeconds)) {
    // Late writes do not merely fail — they close the attempt. Leaving it
    // `in_progress` would keep the one-live-attempt index blocking the next
    // sitting until something else noticed.
    await expireAttempt(attemptId);
    return { ok: false, reason: "expired" };
  }

  // The question must belong to this attempt's quiz, and every option to that
  // question. Without this an answer can be recorded against another quiz's
  // question, which would then be scored.
  const [question] = await db
    .select({ id: quizQuestions.id })
    .from(quizQuestions)
    .where(
      and(
        eq(quizQuestions.id, questionId),
        eq(quizQuestions.quizId, attempt.quizId),
      ),
    );
  if (!question) return { ok: false, reason: "not_found" };

  if (selectedOptionIds.length > 0) {
    const valid = await db
      .select({ id: quizOptions.id })
      .from(quizOptions)
      .where(
        and(
          eq(quizOptions.questionId, questionId),
          inArray(quizOptions.id, selectedOptionIds),
        ),
      );
    if (valid.length !== new Set(selectedOptionIds).size) {
      return { ok: false, reason: "unknown_option" };
    }
  }

  await db
    .insert(attemptAnswers)
    .values({
      attemptId,
      questionId,
      selectedOptionIds,
      // Analytics only. A number the candidate's browser chose can never
      // decide the candidate's mark, so it is stored and never read by
      // scoring.
      timeSpentMs: timeSpentMs ?? null,
      answeredAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [attemptAnswers.attemptId, attemptAnswers.questionId],
      set: {
        selectedOptionIds,
        timeSpentMs: timeSpentMs ?? null,
        answeredAt: new Date(),
      },
    });

  return { ok: true };
}

// ── Scoring ─────────────────────────────────────────────────────────────────

export interface SubmitOutcome {
  score: number;
  maxScore: number;
  percent: number;
  passed: boolean;
}

export type SubmitResult =
  | ({ ok: true; expired: boolean } & SubmitOutcome)
  | { ok: false; reason: "not_found" | "not_live" };

/**
 * Marks the paper.
 *
 * Reads the answer key from the database at this moment and applies
 * `lib/exams/score.ts`. The submission carries `{ questionId,
 * selectedOptionIds }` and nothing else — a payload with a `score`,
 * `isCorrect` or `passed` field is rejected by the action above this, not
 * quietly ignored, because a client that sends one is either broken or lying
 * and both are worth surfacing.
 */
export async function submitAttempt(
  attemptId: string,
  userId: string,
): Promise<SubmitResult> {
  const db = getDb();

  const [attempt] = await db
    .select({
      id: examAttempts.id,
      userId: examAttempts.userId,
      quizId: examAttempts.quizId,
      status: examAttempts.status,
      expiresAt: examAttempts.expiresAt,
      graceSeconds: quizzes.graceSeconds,
      passMarkPercent: quizzes.passMarkPercent,
    })
    .from(examAttempts)
    .innerJoin(quizzes, eq(quizzes.id, examAttempts.quizId))
    .where(eq(examAttempts.id, attemptId));

  if (!attempt || attempt.userId !== userId)
    return { ok: false, reason: "not_found" };
  if (attempt.status !== "in_progress")
    return { ok: false, reason: "not_live" };

  // A late submit is still scored — on whatever was saved before the deadline.
  // Discarding the work because the last click was two seconds late would
  // punish latency rather than time-keeping.
  const expired = !isWithinDeadline(attempt.expiresAt, attempt.graceSeconds);

  const outcome = await scoreAndClose(
    attempt.id,
    attempt.quizId,
    attempt.passMarkPercent,
    expired ? "expired" : "submitted",
  );

  return { ok: true, expired, ...outcome };
}

/** Reads the key, marks every answer, and closes the attempt in one transaction. */
async function scoreAndClose(
  attemptId: string,
  quizId: string,
  passMarkPercent: number,
  status: "submitted" | "expired",
): Promise<SubmitOutcome> {
  const db = getDb();

  const questionRows = await db
    .select({
      id: quizQuestions.id,
      type: quizQuestions.type,
      points: quizQuestions.points,
      partialCredit: quizQuestions.partialCredit,
    })
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quizId))
    .orderBy(asc(quizQuestions.position));

  const correctRows = questionRows.length
    ? await db
        .select({ id: quizOptions.id, questionId: quizOptions.questionId })
        .from(quizOptions)
        .where(
          and(
            inArray(
              quizOptions.questionId,
              questionRows.map((q) => q.id),
            ),
            eq(quizOptions.isCorrect, true),
          ),
        )
    : [];

  const scorable: ScorableQuestion[] = questionRows.map((question) => ({
    id: question.id,
    type: question.type,
    points: question.points,
    partialCredit: question.partialCredit,
    correctOptionIds: correctRows
      .filter((option) => option.questionId === question.id)
      .map((option) => option.id),
  }));

  const saved = await db
    .select({
      questionId: attemptAnswers.questionId,
      selectedOptionIds: attemptAnswers.selectedOptionIds,
    })
    .from(attemptAnswers)
    .where(eq(attemptAnswers.attemptId, attemptId));

  const submission = Object.fromEntries(
    saved.map((row) => [row.questionId, row.selectedOptionIds]),
  );

  const result = scoreAttempt(scorable, submission, passMarkPercent);
  const byQuestion = new Map(
    result.outcomes.map((one) => [one.questionId, one]),
  );

  await db.transaction(async (tx) => {
    for (const row of saved) {
      const outcome = byQuestion.get(row.questionId);
      if (!outcome) continue;
      await tx
        .update(attemptAnswers)
        .set({
          isCorrect: outcome.isCorrect,
          pointsAwarded: outcome.pointsAwarded,
        })
        .where(
          and(
            eq(attemptAnswers.attemptId, attemptId),
            eq(attemptAnswers.questionId, row.questionId),
          ),
        );
    }

    await tx
      .update(examAttempts)
      .set({
        status,
        submittedAt: new Date(),
        score: result.score,
        maxScore: result.maxScore,
        passed: result.passed,
      })
      .where(eq(examAttempts.id, attemptId));
  });

  return {
    score: result.score,
    maxScore: result.maxScore,
    percent: result.percent,
    passed: result.passed,
  };
}

/** Closes one attempt as expired, scoring what was saved. */
async function expireAttempt(attemptId: string): Promise<void> {
  const db = getDb();
  const [attempt] = await db
    .select({
      quizId: examAttempts.quizId,
      passMarkPercent: quizzes.passMarkPercent,
    })
    .from(examAttempts)
    .innerJoin(quizzes, eq(quizzes.id, examAttempts.quizId))
    .where(eq(examAttempts.id, attemptId));
  if (!attempt) return;
  await scoreAndClose(
    attemptId,
    attempt.quizId,
    attempt.passMarkPercent,
    "expired",
  );
}

/**
 * Closes attempts whose deadline has passed and which nobody submitted.
 *
 * Necessary, not tidy-up. The one-live-attempt index is what makes the attempt
 * cap enforceable under concurrency, and its cost is that an attempt left
 * `in_progress` by a closed laptop blocks every future sitting of that quiz
 * for that person. Something has to release it, and the client cannot: the
 * whole case is that the client is gone.
 *
 * Called lazily on start rather than from a cron: the person it matters to is
 * the one trying to sit the quiz again, and they are the one triggering it.
 * Scoped to a quiz and user when given one, so the common path touches at most
 * one row.
 */
export async function sweepExpiredAttempts(
  quizId?: string,
  userId?: string,
): Promise<number> {
  const db = getDb();

  const scope = [
    eq(examAttempts.status, "in_progress"),
    // `expires_at + grace` in SQL, so the comparison uses one clock — the
    // database's — rather than this process's idea of now.
    sql`${examAttempts.expiresAt} + make_interval(secs => ${quizzes.graceSeconds}) < now()`,
  ];
  if (quizId) scope.push(eq(examAttempts.quizId, quizId));
  if (userId) scope.push(eq(examAttempts.userId, userId));

  const stale = await db
    .select({
      id: examAttempts.id,
      quizId: examAttempts.quizId,
      passMarkPercent: quizzes.passMarkPercent,
    })
    .from(examAttempts)
    .innerJoin(quizzes, eq(quizzes.id, examAttempts.quizId))
    .where(and(...scope));

  for (const attempt of stale) {
    await scoreAndClose(
      attempt.id,
      attempt.quizId,
      attempt.passMarkPercent,
      "expired",
    );
  }

  return stale.length;
}

/** Attempts a person has already made, newest first. */
export async function listAttempts(quizSlug: string, userId: string) {
  const db = getDb();
  return db
    .select({
      id: examAttempts.id,
      attemptNumber: examAttempts.attemptNumber,
      status: examAttempts.status,
      score: examAttempts.score,
      maxScore: examAttempts.maxScore,
      passed: examAttempts.passed,
      submittedAt: examAttempts.submittedAt,
      startedAt: examAttempts.startedAt,
    })
    .from(examAttempts)
    .innerJoin(quizzes, eq(quizzes.id, examAttempts.quizId))
    .where(and(eq(quizzes.slug, quizSlug), eq(examAttempts.userId, userId)))
    .orderBy(desc(examAttempts.attemptNumber));
}
