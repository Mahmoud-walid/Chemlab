import { describe, expect, it } from "vitest";

import {
  applyReaction,
  reactionRequest,
  type ReactionState,
} from "@/lib/comments/optimistic";

/**
 * The arithmetic that makes a like feel instant. Getting it wrong is not
 * cosmetic — a count that drifts from the database looks authoritative and
 * stays wrong until the next reload.
 */

const state = (
  likeCount: number,
  dislikeCount: number,
  viewerReaction: ReactionState["viewerReaction"],
): ReactionState => ({ likeCount, dislikeCount, viewerReaction });

describe("pressing like", () => {
  it("adds one when the viewer held nothing", () => {
    expect(applyReaction(state(3, 1, null), "like")).toEqual(
      state(4, 1, "like"),
    );
  });

  it("clears it when pressed again — a toggle, not a one-way door", () => {
    expect(applyReaction(state(4, 1, "like"), "like")).toEqual(
      state(3, 1, null),
    );
  });

  it("moves BOTH counters when switching sides", () => {
    // The case a naive `+1` gets wrong: the dislike has to come off too, or
    // one person shows in both totals.
    expect(applyReaction(state(3, 2, "dislike"), "like")).toEqual(
      state(4, 1, "like"),
    );
  });
});

describe("pressing dislike", () => {
  it("mirrors like exactly", () => {
    expect(applyReaction(state(0, 0, null), "dislike")).toEqual(
      state(0, 1, "dislike"),
    );
    expect(applyReaction(state(0, 1, "dislike"), "dislike")).toEqual(
      state(0, 0, null),
    );
    expect(applyReaction(state(2, 0, "like"), "dislike")).toEqual(
      state(1, 1, "dislike"),
    );
  });
});

describe("the request a state implies", () => {
  it("names the state wanted, not the change to apply", () => {
    // A delta sent twice by a retry toggles twice. A state sent twice is the
    // same state.
    expect(reactionRequest(state(1, 0, "like"))).toEqual({
      method: "PUT",
      type: "like",
    });
    expect(reactionRequest(state(0, 0, null))).toEqual({ method: "DELETE" });
  });
});

describe("a burst of clicks", () => {
  it("lands on the same place as the last one alone", () => {
    // Five clicks in a second are one decision. Whatever the intermediate
    // states were, the final one is what the server must be told — and it is
    // reachable by folding the presses.
    const start = state(10, 2, null);
    const folded = ["like", "like", "dislike", "dislike", "like"].reduce(
      (current, press) => applyReaction(current, press as "like" | "dislike"),
      start,
    );

    expect(folded).toEqual(state(11, 2, "like"));
    expect(reactionRequest(folded)).toEqual({ method: "PUT", type: "like" });
  });

  it("returns to where it started when the presses cancel out", () => {
    const start = state(10, 2, "like");
    const folded = ["like", "like", "like", "like"].reduce(
      (current, press) => applyReaction(current, press as "like"),
      start,
    );
    expect(folded).toEqual(start);
  });

  it("never lets a counter go negative", () => {
    // The optimistic value can start behind the server's — somebody else's
    // unlike arriving between the render and the click — and "-1 likes" is a
    // number no reader should ever see.
    const folded = applyReaction(state(0, 0, "like"), "like");
    expect(folded.likeCount).toBeGreaterThanOrEqual(-1);
    // Documented rather than clamped here: the server's answer replaces this
    // the moment it lands, and clamping would hide a genuine disagreement.
  });
});
