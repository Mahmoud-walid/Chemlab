import type { CommentReaction } from "./types";

/**
 * What a reaction click does to the row on screen, before the server answers.
 *
 * Pure, so the arithmetic that makes a like feel instant is testable without a
 * network or a component. Getting it wrong is not cosmetic: a count that
 * drifts from the database looks authoritative and is wrong until the next
 * reload.
 */

export interface ReactionState {
  likeCount: number;
  dislikeCount: number;
  viewerReaction: CommentReaction;
}

/**
 * Pressing `type` when the viewer currently holds `viewerReaction`.
 *
 * Pressing the side you already hold CLEARS it — that is what makes a like
 * button a toggle rather than a one-way door, and it is why the request is
 * "set this state", not "apply this delta": a delta sent twice by a retry
 * toggles twice.
 */
export function applyReaction(
  state: ReactionState,
  type: "like" | "dislike",
): ReactionState {
  const next: CommentReaction = state.viewerReaction === type ? null : type;

  return {
    viewerReaction: next,
    likeCount:
      state.likeCount -
      (state.viewerReaction === "like" ? 1 : 0) +
      (next === "like" ? 1 : 0),
    dislikeCount:
      state.dislikeCount -
      (state.viewerReaction === "dislike" ? 1 : 0) +
      (next === "dislike" ? 1 : 0),
  };
}

/**
 * The request a state implies: `PUT` with a type, or `DELETE`.
 *
 * Named as the state wanted rather than the change to apply, so a double-tap
 * and a retry both land on the same row instead of toggling twice.
 */
export function reactionRequest(
  state: ReactionState,
): { method: "PUT"; type: "like" | "dislike" } | { method: "DELETE" } {
  return state.viewerReaction === null
    ? { method: "DELETE" }
    : { method: "PUT", type: state.viewerReaction };
}

/**
 * Rapid toggling must reach the server ONCE, as the final state.
 *
 * Five clicks in a second are one decision, and sending five requests races
 * them: they can arrive out of order, and the row ends up holding whichever
 * lost. This collapses them — the caller keeps the latest state and sends it
 * after the window, so the server sees the answer rather than the argument.
 */
export const COLLAPSE_MS = 400;
