import { describe, expect, it } from "vitest";

import {
  FUNNEL_STAGES,
  funnelRows,
  type FunnelStage,
} from "@/lib/activity/funnel";

/**
 * The arithmetic behind the pipeline view, checked against hand-computed
 * values — #19's acceptance criterion, and the reason the stages are pure
 * data rather than a query.
 */

const at = (rows: ReturnType<typeof funnelRows>, key: string) =>
  rows.find((row) => row.key === key)!;

describe("the funnel's shape", () => {
  it("starts at registered, not at visitor", () => {
    // We do not record anonymous page views, so a "visitor" stage would be an
    // invented denominator. The first stage is the first thing we can count.
    expect(FUNNEL_STAGES[0]!.key).toBe("registered");
  });

  it("ends at passed", () => {
    expect(FUNNEL_STAGES[FUNNEL_STAGES.length - 1]!.key).toBe("passed");
  });

  it("counts sittings from attempts, not from events", () => {
    // The attempt row is authoritative; an event stream can lose a
    // fire-and-forget write.
    for (const stage of FUNNEL_STAGES.filter((s) => s.key.startsWith("exam"))) {
      expect(stage.source.kind).toBe("attempt");
    }
    expect(at(funnelRows({}), "passed")).toBeTruthy();
  });
});

describe("conversion arithmetic", () => {
  const counts = {
    registered: 100,
    lessonRead: 60,
    examStarted: 30,
    examSubmitted: 24,
    passed: 18,
  };

  it("reports each stage's head count unchanged", () => {
    const rows = funnelRows(counts);
    for (const [key, value] of Object.entries(counts)) {
      expect(at(rows, key).people).toBe(value);
    }
  });

  it("converts from the PREVIOUS stage, not from the first", () => {
    // 24 of 30 who started actually submitted — 80%. Measuring against the
    // 100 who registered would say 24% and hide where people actually stop.
    const rows = funnelRows(counts);
    expect(at(rows, "examSubmitted").conversion).toBe(80);
    expect(at(rows, "examSubmitted").ofFirst).toBe(24);
  });

  it("reports drop-off as the complement of conversion", () => {
    const rows = funnelRows(counts);
    for (const row of rows) {
      if (row.conversion === null) {
        expect(row.dropOff).toBeNull();
      } else {
        expect(row.dropOff).toBe(100 - row.conversion);
      }
    }
  });

  it("leaves the first stage without a conversion", () => {
    // There is nothing before it. A 100% would imply a stage that is not there.
    const rows = funnelRows(counts);
    expect(at(rows, "registered").conversion).toBeNull();
    expect(at(rows, "registered").dropOff).toBeNull();
    expect(at(rows, "registered").ofFirst).toBeNull();
  });

  it("says nothing rather than 0% when the previous stage is empty", () => {
    // Reporting 0% would claim everybody dropped out of a stage nobody
    // reached, which is a different and false statement.
    const rows = funnelRows({ registered: 0, lessonRead: 0 });
    expect(at(rows, "lessonRead").conversion).toBeNull();
    expect(at(rows, "lessonRead").dropOff).toBeNull();
  });

  it("returns a row per stage even with no data at all", () => {
    const rows = funnelRows({});
    expect(rows).toHaveLength(FUNNEL_STAGES.length);
    expect(rows.every((row) => row.people === 0)).toBe(true);
  });

  it("handles a stage that grew — it does not clamp", () => {
    // Should not happen, since each stage is a subset of the one before. If it
    // ever does, showing 120% is how somebody notices; silently clamping to
    // 100% is how a broken query goes unnoticed for months.
    const rows = funnelRows({ registered: 10, lessonRead: 12 });
    expect(at(rows, "lessonRead").conversion).toBe(120);
    expect(at(rows, "lessonRead").dropOff).toBe(-20);
  });

  it("rounds to whole percents", () => {
    const rows = funnelRows({ registered: 3, lessonRead: 2 });
    expect(at(rows, "lessonRead").conversion).toBe(67);
  });
});

describe("a stage nothing emits yet", () => {
  /**
   * Every shipped stage has an emitter as of #20 — `lesson.viewed` is
   * recorded by the lesson page's beacon. The machinery stays, and stays
   * tested against a fabricated stage list, because the next stage added to
   * the funnel will be unmeasured on the day it lands. Counting an unemitted
   * stage as "0 people" would be a false claim rather than a measurement,
   * and would make the NEXT stage's conversion a division by a structural
   * zero.
   */
  const STAGES: FunnelStage[] = [
    { key: "registered", source: { kind: "verb", verbs: ["auth.signed_up"] } },
    {
      key: "unmeasured",
      source: { kind: "verb", verbs: ["lesson.completed"] },
      notYetRecorded: true,
    },
    { key: "examStarted", source: { kind: "attempt", status: "any" } },
    { key: "examSubmitted", source: { kind: "attempt", status: "finished" } },
    { key: "passed", source: { kind: "attempt", status: "passed" } },
  ];

  it("every shipped stage now has something emitting it", () => {
    // The flag names a gap. One that outlives the gap is a screen saying
    // "not recorded yet" about data that is being recorded.
    expect(FUNNEL_STAGES.filter((stage) => stage.notYetRecorded)).toEqual([]);
  });

  it("marks the stage rather than reporting a zero as data", () => {
    const rows = funnelRows({ registered: 100, examStarted: 30 }, STAGES);
    expect(at(rows, "unmeasured").notYetRecorded).toBe(true);
    expect(at(rows, "registered").notYetRecorded).toBe(false);
  });

  it("converts the next stage against the last MEASURED one", () => {
    // 30 of the 100 who registered started a quiz. Converting against the
    // unmeasured stage would report "no answer" for every stage after it,
    // which is how one gap swallows the rest of the funnel.
    const rows = funnelRows(
      { registered: 100, unmeasured: 0, examStarted: 30 },
      STAGES,
    );
    expect(at(rows, "examStarted").conversion).toBe(30);
    expect(at(rows, "examStarted").dropOff).toBe(70);
  });

  it("still reports the measured stages after it normally", () => {
    const rows = funnelRows(
      {
        registered: 100,
        unmeasured: 0,
        examStarted: 30,
        examSubmitted: 24,
        passed: 18,
      },
      STAGES,
    );
    expect(at(rows, "examSubmitted").conversion).toBe(80);
    expect(at(rows, "passed").conversion).toBe(75);
  });
});
