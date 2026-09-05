import { describe, expect, it } from "vitest";

import {
  TRANSLATION_RANK,
  TRANSLATION_STATES,
  isServedToReaders,
  isTranslationState,
  needsAttention,
  rankFromState,
  stateFromRank,
  worstOf,
} from "@/lib/translations/state";

describe("the translation ladder", () => {
  it("ranks every state, and no two share a rank", () => {
    // The SQL takes `greatest()` over these numbers. Two states sharing one
    // would make a filter silently match both.
    const ranks = TRANSLATION_STATES.map((state) => TRANSLATION_RANK[state]);
    expect(new Set(ranks).size).toBe(TRANSLATION_STATES.length);
  });

  it("orders them worst first", () => {
    // Not decoration: `worstOf` and the SQL both depend on this order being
    // "how far from done", and `missing` outranking `stale` is why a lesson
    // with one untranslated section does not read as merely out of date.
    expect(TRANSLATION_RANK.missing).toBeGreaterThan(TRANSLATION_RANK.draft);
    expect(TRANSLATION_RANK.draft).toBeGreaterThan(TRANSLATION_RANK.in_review);
    expect(TRANSLATION_RANK.in_review).toBeGreaterThan(TRANSLATION_RANK.stale);
    expect(TRANSLATION_RANK.stale).toBeGreaterThan(TRANSLATION_RANK.published);
  });

  it("round-trips a state through its rank", () => {
    for (const state of TRANSLATION_STATES) {
      expect(stateFromRank(TRANSLATION_RANK[state])).toBe(state);
      expect(rankFromState(state)).toBe(TRANSLATION_RANK[state]);
    }
  });

  it("reads an unknown rank as published rather than throwing", () => {
    // The rank arrives from SQL. A shape nobody expected should show a
    // finished translation, not crash the admin list.
    expect(stateFromRank(99)).toBe("published");
    expect(stateFromRank(-1)).toBe("published");
  });

  it("rejects a filter value that is not a state", () => {
    expect(rankFromState("everything")).toBeUndefined();
    expect(isTranslationState("stale")).toBe(true);
    expect(isTranslationState("STALE")).toBe(false);
    expect(isTranslationState(4)).toBe(false);
  });
});

describe("worstOf", () => {
  it("takes the least finished part", () => {
    expect(worstOf(["published", "stale", "published"])).toBe("stale");
    expect(worstOf(["stale", "missing"])).toBe("missing");
    expect(worstOf(["in_review", "draft"])).toBe("draft");
  });

  it("calls a lesson with no parts published, not missing", () => {
    // A summary-only lesson has nothing left untranslated. Calling that
    // "missing" would park every one of them in the missing filter forever.
    expect(worstOf([])).toBe("published");
  });
});

describe("what each state means to somebody", () => {
  it("counts stale as live, because a stale lesson is still served", () => {
    expect(isServedToReaders("stale")).toBe(true);
    expect(isServedToReaders("published")).toBe(true);
    expect(isServedToReaders("draft")).toBe(false);
    expect(isServedToReaders("in_review")).toBe(false);
    expect(isServedToReaders("missing")).toBe(false);
  });

  it("counts everything but published as work", () => {
    expect(needsAttention("published")).toBe(false);
    for (const state of ["missing", "draft", "in_review", "stale"] as const) {
      expect(needsAttention(state)).toBe(true);
    }
  });
});
