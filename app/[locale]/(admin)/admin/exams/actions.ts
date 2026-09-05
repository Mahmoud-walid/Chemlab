"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";

import { getDb } from "@/db/client";
import { examAttempts } from "@/db/schema/attempts";
import { auditLog } from "@/db/schema/rbac";
import { recordActivity } from "@/lib/activity/record";
import { requirePermission } from "@/lib/authz";

export interface VoidResult {
  ok: boolean;
  problem?: string;
}

/**
 * Strikes out a sitting.
 *
 * A void is not a delete. The row stays, the reason is recorded, and the mark
 * stops counting toward the quiz's average — "this attempt does not count, and
 * here is why" is a different fact from "this attempt never happened", and
 * only the first one is honest to the candidate whose record it is.
 *
 * It also still counts against their attempt cap. Handing back a sitting would
 * turn the sanction into a reward.
 */
export async function voidAttempt(input: {
  attemptId: string;
  reason: string;
  quizSlug: string;
}): Promise<VoidResult> {
  const actor = await requirePermission("exam:void");

  const reason = input.reason.trim();
  // A reason is the whole point of the audit trail this writes. "Voided by
  // an admin" with no reason is a record nobody can act on six months later,
  // least of all the candidate asking why.
  if (reason.length < 5) {
    return { ok: false, problem: "Give a reason of at least five characters." };
  }
  if (reason.length > 500) {
    return { ok: false, problem: "That reason is too long." };
  }

  const db = getDb();

  const [attempt] = await db
    .select({
      id: examAttempts.id,
      status: examAttempts.status,
      userId: examAttempts.userId,
      score: examAttempts.score,
      maxScore: examAttempts.maxScore,
    })
    .from(examAttempts)
    .where(eq(examAttempts.id, input.attemptId));

  if (!attempt) return { ok: false, problem: "That attempt no longer exists." };
  if (attempt.status === "voided") {
    return { ok: false, problem: "That attempt is already voided." };
  }
  // An in-progress sitting is not voidable: the candidate is mid-paper, and
  // striking it out would leave them typing into a record that no longer
  // accepts writes. Let it finish or expire first.
  if (attempt.status === "in_progress") {
    return { ok: false, problem: "Wait for the attempt to finish or expire." };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(examAttempts)
      .set({ status: "voided", voidReason: reason })
      .where(
        and(
          eq(examAttempts.id, input.attemptId),
          // Re-checked inside the transaction: two operators on the same row
          // would otherwise both succeed, and the second would overwrite the
          // first's reason.
          inArray(examAttempts.status, ["submitted", "expired"]),
        ),
      );

    await tx.insert(auditLog).values({
      actorId: actor.userId,
      action: "exam.void",
      targetType: "attempt",
      targetId: input.attemptId,
      before: { status: attempt.status, score: attempt.score },
      after: { status: "voided", reason },
    });
  });

  await recordActivity({
    verb: "exam.voided",
    objectType: "attempt",
    objectId: input.attemptId,
    metadata: {
      reason,
      subjectId: attempt.userId,
      score: attempt.score,
      maxScore: attempt.maxScore,
    },
  });

  revalidatePath(`/admin/exams/${input.quizSlug}`);
  revalidatePath("/profile/exams");
  return { ok: true };
}
