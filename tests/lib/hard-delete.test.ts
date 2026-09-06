import { describe, expect, it } from "vitest";

import {
  HARD_DELETE_REASONS,
  canHardDelete,
  hardDeleteRefusals,
  type HardDeleteState,
} from "@/lib/admin/hard-delete";

const clean: HardDeleteState = {
  status: "draft",
  publishedAt: null,
  comments: 0,
  engagement: 0,
  activity: 0,
  attempts: 0,
};

describe("hardDeleteRefusals", () => {
  it("allows a draft nobody has touched", () => {
    // The only thing hard delete is for: a row created by mistake.
    expect(hardDeleteRefusals(clean)).toEqual([]);
    expect(canHardDelete(clean)).toBe(true);
  });

  it("refuses anything currently published", () => {
    expect(hardDeleteRefusals({ ...clean, status: "published" })).toContain(
      "published",
    );
  });

  it("refuses a withdrawn row that was ever published", () => {
    // The case the criterion calls out separately, and the one most likely to
    // be got wrong: the status now says archived, and `published_at` is the
    // only thing that remembers readers once saw it. Withdrawing does not
    // unsee a lesson.
    const withdrawn = {
      ...clean,
      status: "archived" as const,
      publishedAt: new Date(),
    };
    expect(hardDeleteRefusals(withdrawn)).toEqual(["wasPublished"]);
    expect(canHardDelete(withdrawn)).toBe(false);
  });

  it("refuses a row anything refers to", () => {
    const cases: [Partial<HardDeleteState>, string][] = [
      [{ comments: 1 }, "hasComments"],
      [{ engagement: 1 }, "hasEngagement"],
      [{ activity: 1 }, "hasActivity"],
      [{ attempts: 1 }, "hasAttempts"],
    ];
    for (const [overrides, reason] of cases) {
      expect(hardDeleteRefusals({ ...clean, ...overrides })).toEqual([reason]);
    }
  });

  it("reports every reason, not the first", () => {
    // An operator who clears one blocker and is then told about the next has
    // been made to discover the rules one round trip at a time.
    const busy: HardDeleteState = {
      status: "published",
      publishedAt: new Date(),
      comments: 3,
      engagement: 2,
      activity: 40,
      attempts: 1,
    };
    expect(hardDeleteRefusals(busy)).toEqual([...HARD_DELETE_REASONS]);
  });

  it("returns reasons in the declared order, whatever the input", () => {
    // The order is the order a person wants to hear them: what it IS before
    // what points at it.
    const reasons = hardDeleteRefusals({
      ...clean,
      attempts: 1,
      status: "published",
    });
    expect(reasons).toEqual(["published", "hasAttempts"]);
  });
});
