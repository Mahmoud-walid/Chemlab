"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";

import {
  getPaper,
  saveAnswer,
  startAttempt,
  submitAttempt,
  type Paper,
} from "@/db/queries/exams/attempts";
import { recordActivity } from "@/lib/activity/record";
import { requireUser } from "@/lib/session";

/**
 * The candidate-facing actions.
 *
 * Every one of them resolves the user from the SESSION. None takes a user id,
 * so there is no parameter to forge — the same reason `recordActivity` reads
 * its actor from the session rather than from its caller.
 */

export interface BeginResult {
  ok: boolean;
  attemptId?: string;
  reason?: "not_found" | "attempts_exhausted" | "cooling_down";
  availableAt?: string;
}

export async function beginAttempt(slug: string): Promise<BeginResult> {
  const user = await requireUser();
  const result = await startAttempt(slug, user.id);

  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      availableAt: result.availableAt?.toISOString(),
    };
  }

  // Resuming is not starting. Recording it as a start would make the activity
  // stream count every refresh as a fresh sitting.
  if (!result.resumed) {
    await recordActivity({
      verb: "exam.started",
      objectType: "attempt",
      objectId: result.attemptId,
      metadata: { slug },
    });
  }

  return { ok: true, attemptId: result.attemptId };
}

/** The in-progress paper, re-read after every navigation. */
export async function loadPaper(attemptId: string): Promise<Paper | null> {
  const user = await requireUser();
  return getPaper(attemptId, user.id, await getLocale());
}

export interface AnswerInput {
  attemptId: string;
  questionId: string;
  selectedOptionIds: string[];
  /** Client-reported, for analytics. Never reaches scoring. */
  timeSpentMs?: number;
}

export type AnswerResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_found" | "not_live" | "expired" | "unknown_option";
    };

/**
 * Saves one answer.
 *
 * The payload is deliberately narrow. A body carrying `isCorrect`, `score` or
 * `passed` is REJECTED rather than ignored: a client that sends one is either
 * broken or lying, and silently dropping the field hides both.
 */
export async function answerQuestion(
  input: AnswerInput,
): Promise<AnswerResult> {
  const user = await requireUser();
  rejectClaimedMarks(input);

  return saveAnswer(
    input.attemptId,
    user.id,
    input.questionId,
    Array.isArray(input.selectedOptionIds) ? input.selectedOptionIds : [],
    typeof input.timeSpentMs === "number" ? input.timeSpentMs : undefined,
  );
}

export interface FinishResult {
  ok: boolean;
  expired?: boolean;
  reason?: "not_found" | "not_live";
}

export async function finishAttempt(input: {
  attemptId: string;
}): Promise<FinishResult> {
  const user = await requireUser();
  rejectClaimedMarks(input);

  const result = await submitAttempt(input.attemptId, user.id);
  if (!result.ok) return { ok: false, reason: result.reason };

  await recordActivity({
    verb: "exam.submitted",
    objectType: "attempt",
    objectId: input.attemptId,
    // The mark, in the stream, from the server's own computation.
    metadata: {
      score: result.score,
      maxScore: result.maxScore,
      percent: result.percent,
      passed: result.passed,
      expired: result.expired,
    },
  });

  revalidatePath("/profile/exams");
  return { ok: true, expired: result.expired };
}

/**
 * Refuses a payload that claims a mark.
 *
 * Nothing legitimate sends these. Throwing rather than stripping them means a
 * bug that starts sending one is a loud failure in development instead of a
 * field that silently stopped mattering.
 */
function rejectClaimedMarks(payload: object): void {
  for (const claimed of ["score", "isCorrect", "passed", "pointsAwarded"]) {
    if (claimed in payload) {
      throw new Error(
        `"${claimed}" is computed on the server and must not be submitted.`,
      );
    }
  }
}
