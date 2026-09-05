import { describe, expect, it } from "vitest";

import {
  gradeKey,
  percentage,
  scoreAttempt,
  scoreQuestion,
  type ScorableQuestion,
} from "@/lib/exams/score";

const single = (over: Partial<ScorableQuestion> = {}): ScorableQuestion => ({
  id: "q1",
  type: "single_choice",
  points: 1,
  partialCredit: false,
  correctOptionIds: ["a"],
  ...over,
});

const multi = (over: Partial<ScorableQuestion> = {}): ScorableQuestion => ({
  id: "q1",
  type: "multiple_choice",
  points: 4,
  partialCredit: false,
  correctOptionIds: ["a", "b"],
  ...over,
});

describe("single choice", () => {
  it("awards the points for the right option", () => {
    expect(scoreQuestion(single(), ["a"])).toMatchObject({
      isCorrect: true,
      pointsAwarded: 1,
    });
  });

  it("awards nothing for the wrong option", () => {
    expect(scoreQuestion(single(), ["b"])).toMatchObject({
      isCorrect: false,
      pointsAwarded: 0,
    });
  });

  it("awards nothing when nothing was chosen", () => {
    expect(scoreQuestion(single(), undefined).pointsAwarded).toBe(0);
    expect(scoreQuestion(single(), []).pointsAwarded).toBe(0);
  });

  it("refuses a multi-selection that happens to include the right one", () => {
    // Otherwise ticking every option is a guaranteed mark. This is a
    // malformed answer, not a partial one.
    expect(scoreQuestion(single(), ["a", "b"])).toMatchObject({
      isCorrect: false,
      pointsAwarded: 0,
    });
  });

  it("respects a question worth more than one point", () => {
    expect(scoreQuestion(single({ points: 5 }), ["a"]).pointsAwarded).toBe(5);
  });

  it("ignores partialCredit, which is a multiple-choice policy", () => {
    expect(
      scoreQuestion(single({ partialCredit: true }), ["b"]).pointsAwarded,
    ).toBe(0);
  });
});

describe("multiple choice, all or nothing", () => {
  it("awards full marks for exactly the right set", () => {
    expect(scoreQuestion(multi(), ["a", "b"])).toMatchObject({
      isCorrect: true,
      pointsAwarded: 4,
    });
  });

  it("does not care what order they were chosen in", () => {
    expect(scoreQuestion(multi(), ["b", "a"]).isCorrect).toBe(true);
  });

  it("awards nothing for a subset", () => {
    expect(scoreQuestion(multi(), ["a"]).pointsAwarded).toBe(0);
  });

  it("awards nothing for the right set plus a wrong one", () => {
    expect(scoreQuestion(multi(), ["a", "b", "c"]).pointsAwarded).toBe(0);
  });
});

describe("multiple choice, partial credit", () => {
  const question = multi({ partialCredit: true });

  it("awards half for one of two right, with nothing wrong", () => {
    expect(scoreQuestion(question, ["a"]).pointsAwarded).toBe(2);
  });

  it("cancels a right tick with a wrong one", () => {
    // (1 hit − 1 miss) / 2 correct = 0. This is the whole point of the
    // formula: ticking everything earns nothing.
    expect(scoreQuestion(question, ["a", "c"]).pointsAwarded).toBe(0);
  });

  it("never goes negative", () => {
    expect(
      scoreQuestion(question, ["c", "d", "e"]).pointsAwarded,
    ).toBeGreaterThanOrEqual(0);
  });

  it("still marks a fully correct answer as correct, not merely full-marked", () => {
    const outcome = scoreQuestion(question, ["a", "b"]);
    expect(outcome.isCorrect).toBe(true);
    expect(outcome.pointsAwarded).toBe(4);
  });

  it("marks a partly-right answer as incorrect even though it earned marks", () => {
    // `isCorrect` drives the per-question percent-correct analytics, so it
    // has to mean "got it right", not "got something".
    const outcome = scoreQuestion(question, ["a"]);
    expect(outcome.isCorrect).toBe(false);
    expect(outcome.pointsAwarded).toBeGreaterThan(0);
  });

  it("gives no marks for a question with no correct option recorded", () => {
    // An authoring error, not a free mark — the division would otherwise be
    // by zero and hand everybody full points.
    const broken = multi({ partialCredit: true, correctOptionIds: [] });
    expect(scoreQuestion(broken, ["a"]).pointsAwarded).toBe(0);
  });
});

describe("the whole paper", () => {
  const paper: ScorableQuestion[] = [
    single({ id: "q1", correctOptionIds: ["a"] }),
    single({ id: "q2", correctOptionIds: ["b"], points: 2 }),
    multi({ id: "q3", correctOptionIds: ["x", "y"], points: 3 }),
  ];

  it("adds the points up and reports the percentage", () => {
    const result = scoreAttempt(
      paper,
      { q1: ["a"], q2: ["b"], q3: ["x", "y"] },
      60,
    );
    expect(result.score).toBe(6);
    expect(result.maxScore).toBe(6);
    expect(result.percent).toBe(100);
    expect(result.passed).toBe(true);
  });

  it("counts an unanswered question against the total, not out of it", () => {
    // The alternative — scoring out of what was attempted — would mean
    // answering one question correctly and stopping was a 100%.
    const result = scoreAttempt(paper, { q1: ["a"] }, 60);
    expect(result.score).toBe(1);
    expect(result.maxScore).toBe(6);
    expect(result.passed).toBe(false);
  });

  it("returns an outcome per question, in the paper's order", () => {
    const result = scoreAttempt(paper, { q2: ["b"] }, 60);
    expect(result.outcomes.map((o) => o.questionId)).toEqual([
      "q1",
      "q2",
      "q3",
    ]);
  });

  it("passes exactly at the pass mark, not above it", () => {
    const two: ScorableQuestion[] = [
      single({ id: "q1" }),
      single({ id: "q2", correctOptionIds: ["b"] }),
    ];
    expect(scoreAttempt(two, { q1: ["a"] }, 50).passed).toBe(true);
    expect(scoreAttempt(two, { q1: ["a"] }, 51).passed).toBe(false);
  });

  it("scores a quiz with no questions as zero, and not as a pass", () => {
    // 0/0 is not 100%. An empty draft must not mark everyone who opened it
    // as having passed.
    const result = scoreAttempt([], {}, 60);
    expect(result.percent).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.outcomes).toEqual([]);
  });

  it("ignores a submission for a question that is not on the paper", () => {
    // A question deleted mid-attempt, or a crafted payload. Either way it
    // must not add marks.
    const result = scoreAttempt(paper, { q1: ["a"], deleted: ["a"] }, 60);
    expect(result.score).toBe(1);
    expect(result.maxScore).toBe(6);
  });
});

describe("percentage", () => {
  it("rounds to the nearest whole percent", () => {
    expect(percentage(2, 3)).toBe(67);
    expect(percentage(1, 3)).toBe(33);
  });

  it("returns 0 rather than NaN when there is nothing to score", () => {
    expect(percentage(0, 0)).toBe(0);
    expect(percentage(5, 0)).toBe(0);
  });
});

describe("gradeKey", () => {
  it("returns a message key, never English", () => {
    // The old `gradeLabel()` returned "Excellent!" from a lib module, which
    // put an English string into an Arabic page with nothing next-intl could
    // reach.
    for (const percent of [0, 59, 60, 74, 75, 89, 90, 100]) {
      expect(gradeKey(percent)).toMatch(/^[a-zA-Z]+$/);
    }
  });

  it("bands on the boundaries", () => {
    expect(gradeKey(90)).toBe("excellent");
    expect(gradeKey(89)).toBe("good");
    expect(gradeKey(75)).toBe("good");
    expect(gradeKey(74)).toBe("fair");
    expect(gradeKey(60)).toBe("fair");
    expect(gradeKey(59)).toBe("needsWork");
  });
});
