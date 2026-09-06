import { describe, expect, it } from "vitest";

import {
  ciPreferencesPatchSchema,
  isValidBranchPattern,
  toUpdate,
} from "@/lib/ci/preferences-input";
import { watchesBranch } from "@/lib/ci/policy";

/**
 * What the settings form is allowed to send.
 *
 * The interesting half is the branch list, because its failure is silent in
 * the direction that matters: an unrecognised pattern is a watch list that
 * matches nothing, which reads on the page as opted in and behaves as opted
 * out. Somebody who believes they are watching `main` and is not has the
 * exact problem this feature exists to solve.
 */

describe("branch patterns", () => {
  it.each(["*", "main", "feat/*", "release/2026", "a".repeat(200)])(
    "accepts %s",
    (pattern) => {
      expect(isValidBranchPattern(pattern)).toBe(true);
    },
  );

  it.each([
    ["", "empty"],
    [" main", "a leading space"],
    ["main ", "a trailing space"],
    ["feat*", "a wildcard that is not a trailing /*"],
    ["fe*at", "a wildcard in the middle"],
    ["main..old", "a double dot, which git itself refuses"],
    ["a//b", "an empty path segment"],
    ["/main", "a leading slash"],
    ["main/", "a trailing slash"],
    ["-main", "a leading dash, which reads as an option"],
    ["main.lock", "a ref lock file name"],
    ["main~1", "a revision expression, not a branch"],
    ["ma in", "an inner space"],
    ["a".repeat(201), "longer than a refname"],
  ])("refuses %s (%s)", (pattern) => {
    expect(isValidBranchPattern(pattern)).toBe(false);
  });

  /**
   * The validator and the matcher have to agree, or the form accepts a
   * pattern the policy will never match — which is the silent failure above,
   * arriving through the front door.
   */
  it("accepts nothing that matches no branch it could plausibly mean", () => {
    expect(watchesBranch(["*"], "anything")).toBe(true);
    expect(watchesBranch(["main"], "main")).toBe(true);
    expect(watchesBranch(["feat/*"], "feat/acids")).toBe(true);
    // And the shape the validator refuses is refused because it matches
    // nothing, not because it looks untidy.
    expect(watchesBranch(["feat*"], "feat/acids")).toBe(false);
    expect(watchesBranch([" main"], "main")).toBe(false);
  });
});

describe("the patch", () => {
  it("accepts a single field", () => {
    expect(ciPreferencesPatchSchema.safeParse({ enabled: true }).success).toBe(
      true,
    );
  });

  it("accepts an empty patch, which changes nothing", () => {
    const parsed = ciPreferencesPatchSchema.safeParse({});
    expect(parsed.success).toBe(true);
    expect(toUpdate(parsed.data!)).toEqual({});
  });

  it("refuses an unknown key rather than dropping it", () => {
    // Dropping it would look, from the form, exactly like the switch working.
    expect(
      ciPreferencesPatchSchema.safeParse({ notifyOnEverything: true }).success,
    ).toBe(false);
  });

  it("refuses an unknown success policy", () => {
    expect(
      ciPreferencesPatchSchema.safeParse({ successPolicy: "sometimes" })
        .success,
    ).toBe(false);
  });

  it("refuses an empty branch list", () => {
    // Not "every branch" and not "the default": a list that matches nothing,
    // shown as opted in. Turning the section off is how you ask for silence.
    const parsed = ciPreferencesPatchSchema.safeParse({ branches: [] });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toContain("at least one branch");
  });

  it("refuses a list containing one bad pattern", () => {
    expect(
      ciPreferencesPatchSchema.safeParse({ branches: ["main", "feat*"] })
        .success,
    ).toBe(false);
  });

  it("refuses an unreasonable number of patterns", () => {
    expect(
      ciPreferencesPatchSchema.safeParse({
        branches: Array.from({ length: 21 }, (_, i) => `b${i}`),
      }).success,
    ).toBe(false);
  });
});

describe("what gets written", () => {
  it("carries only the fields the patch mentioned", () => {
    const parsed = ciPreferencesPatchSchema.parse({ notifyOnCancelled: true });
    // Two tabs open on the settings page: the later save must not undo the
    // earlier one's unrelated switch, which is only true if absent means
    // absent rather than false.
    expect(toUpdate(parsed)).toEqual({ notifyOnCancelled: true });
  });

  it("keeps a field explicitly set to false", () => {
    const parsed = ciPreferencesPatchSchema.parse({ notifyOnFailure: false });
    expect(toUpdate(parsed)).toEqual({ notifyOnFailure: false });
  });

  it("collapses duplicate patterns, keeping the order they were sent in", () => {
    const parsed = ciPreferencesPatchSchema.parse({
      branches: ["main", "feat/*", "main"],
    });
    // A list that grows every time the form is saved hits the ceiling above
    // eventually, and until it does it is just a longer list saying the same
    // thing.
    expect(toUpdate(parsed).branches).toEqual(["main", "feat/*"]);
  });
});
