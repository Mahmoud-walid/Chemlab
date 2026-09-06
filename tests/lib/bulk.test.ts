import { describe, expect, it } from "vitest";

import {
  MAX_BULK_ROWS,
  isWritable,
  planBulk,
  refusedResult,
  withinLimit,
} from "@/lib/admin/bulk";

const rows = [
  { id: "a", label: "Acids" },
  { id: "b", label: "Bases" },
  { id: "c", label: "Catalysis" },
];

const allowAll = () => ({});

describe("planBulk", () => {
  it("writes every row when nothing objects", () => {
    const plan = planBulk(["a", "b", "c"], rows, allowAll);
    expect(plan.apply).toEqual(["a", "b", "c"]);
    expect(plan.unchanged).toEqual([]);
    expect(plan.refused).toEqual([]);
    expect(isWritable(plan)).toBe(true);
  });

  it("keeps the order the operator ticked the boxes in", () => {
    expect(planBulk(["c", "a"], rows, allowAll).apply).toEqual(["c", "a"]);
  });

  it("deduplicates", () => {
    expect(planBulk(["a", "a", "b"], rows, allowAll).apply).toEqual(["a", "b"]);
  });

  it("counts a row already in the target state as unchanged, not refused", () => {
    // Archiving forty lessons of which one is already archived is a request
    // that can be honoured completely. Blocking it would make the all-or-none
    // rule useless in practice.
    const plan = planBulk(["a", "b"], rows, (row) =>
      row.id === "a" ? { skip: true } : {},
    );
    expect(plan.unchanged).toEqual(["a"]);
    expect(plan.apply).toEqual(["b"]);
    expect(isWritable(plan)).toBe(true);
  });

  it("refuses the WHOLE batch when one row is blocked", () => {
    // The strict reading of "either every selected row changes or none does".
    // An operator who asks for forty and gets thirty-seven has to work out
    // which three, from a list they can no longer see.
    const plan = planBulk(["a", "b"], rows, (row) =>
      row.id === "b" ? { refuse: ["missingBody"] } : {},
    );

    expect(isWritable(plan)).toBe(false);
    expect(plan.refused).toEqual([
      {
        id: "b",
        label: "Bases",
        reason: "blocked",
        detail: ["missingBody"],
      },
    ]);
  });

  it("names the row rather than its id", () => {
    // An id in an error message is a puzzle. The label is what the operator
    // was looking at.
    const plan = planBulk(["c"], rows, () => ({ refuse: ["missingBody"] }));
    expect(plan.refused[0]?.label).toBe("Catalysis");
  });

  it("refuses a selected row the database did not return", () => {
    // Deleted by somebody else, or an id that was never the caller's.
    // Silently dropping it lets a stale selection quietly shrink the action.
    const plan = planBulk(["a", "gone"], rows, allowAll);
    expect(plan.refused).toEqual([
      { id: "gone", label: "gone", reason: "missing" },
    ]);
    expect(isWritable(plan)).toBe(false);
  });

  it("reports every offender, not just the first", () => {
    // One at a time would mean as many round trips as there are problems.
    const plan = planBulk(["a", "b", "missing"], rows, (row) =>
      row.id === "a" ? { refuse: ["missingBody"] } : {},
    );
    expect(plan.refused.map((r) => r.id)).toEqual(["a", "missing"]);
  });
});

describe("refusedResult", () => {
  it("writes nothing and says so", () => {
    const plan = planBulk(["a"], rows, () => ({ refuse: ["missingBody"] }));
    expect(refusedResult(plan)).toEqual({
      ok: false,
      applied: 0,
      unchanged: 0,
      refused: plan.refused,
    });
  });
});

describe("an empty refusal list", () => {
  it("is not a refusal", () => {
    // A `decide` that computes blockers and finds none must not refuse the
    // row for having produced an empty array.
    const plan = planBulk(["a"], rows, () => ({ refuse: [] }));
    expect(plan.apply).toEqual(["a"]);
    expect(plan.refused).toEqual([]);
  });
});

describe("withinLimit", () => {
  it("accepts a request at the cap and rejects one past it", () => {
    const ids = (count: number) =>
      Array.from({ length: count }, (_, index) => `row-${index}`);

    expect(withinLimit(ids(MAX_BULK_ROWS))).toBe(true);
    expect(withinLimit(ids(MAX_BULK_ROWS + 1))).toBe(false);
  });

  it("counts distinct ids, so duplicates cannot inflate the request", () => {
    expect(withinLimit(Array(MAX_BULK_ROWS + 50).fill("a"))).toBe(true);
  });
});
