"use server";

import { revalidatePath } from "next/cache";

import { getDb } from "@/db/client";
import {
  commentById,
  deleteComment,
  resolveReports,
  setStatus,
} from "@/db/queries/comments";
import { recordActivity } from "@/lib/activity/record";
import { requirePermission } from "@/lib/authz";

/**
 * What a moderator can do to a reported comment.
 *
 * Every action resolves the reports as well as acting, because a queue that
 * keeps an item after it has been dealt with is a queue nobody trusts. The two
 * are separate functions all the same: deciding a comment is FINE is also a
 * decision, and it needs a way to leave the queue without punishing anybody.
 */

export interface ModerationResult {
  ok: boolean;
  problem?: string;
}

/** Hide, restore, or remove. Reversible except for `removed`, which is a
 * decision rather than a holding state. */
export async function moderateComment(
  commentId: string,
  status: "visible" | "hidden" | "removed",
): Promise<ModerationResult> {
  const actor = await requirePermission("comment:moderate");
  const db = getDb();

  const comment = await commentById(db, commentId);
  if (!comment) return { ok: false, problem: "not-found" };

  await setStatus(db, commentId, status);
  // Acting on it settles the reports: leaving them open would show the same
  // comment in the queue tomorrow with nothing left to do about it.
  await resolveReports(db, commentId, actor.userId);

  // The audit trail is the point of a moderation tool: "who hid this, and
  // when" must be answerable months later.
  await recordActivity({
    // Narrowed rather than interpolated: the verb list is a closed union, and
    // a template string would type as `string` and accept a verb that does not
    // exist.
    verb:
      status === "visible"
        ? "comment.restored"
        : status === "hidden"
          ? "comment.hidden"
          : "comment.removed",
    objectType: "comment",
    objectId: commentId,
    actorId: actor.userId,
  });

  revalidatePath("/admin/comments");
  return { ok: true };
}

/** Deletes it outright. Leaves a tombstone when it has replies — the thread
 * survives, the content does not. */
export async function removeComment(
  commentId: string,
): Promise<ModerationResult> {
  const actor = await requirePermission("comment:delete");
  const db = getDb();

  const outcome = await deleteComment(db, commentId, actor.userId);
  if (outcome === "missing") return { ok: false, problem: "not-found" };

  await resolveReports(db, commentId, actor.userId);
  await recordActivity({
    verb: "comment.deleted",
    objectType: "comment",
    objectId: commentId,
    actorId: actor.userId,
  });

  revalidatePath("/admin/comments");
  return { ok: true };
}

/**
 * Closes the reports without touching the comment.
 *
 * The "this is fine" path. Without it a moderator's only ways to clear the
 * queue are to hide something they think is acceptable or to leave the item
 * there for ever, and both teach them to ignore the queue.
 */
export async function dismissReports(
  commentId: string,
): Promise<ModerationResult> {
  const actor = await requirePermission("comment:moderate");
  const db = getDb();

  const closed = await resolveReports(db, commentId, actor.userId);
  if (closed === 0) return { ok: false, problem: "nothing-open" };

  await recordActivity({
    verb: "comment.dismissed",
    objectType: "comment",
    objectId: commentId,
    actorId: actor.userId,
  });

  revalidatePath("/admin/comments");
  return { ok: true };
}
