import { describe, expect, it } from "vitest";

import {
  MAX_OPTIONS,
  MIN_OPTIONS,
  contiguousPositions,
  minutesFromSeconds,
  moved,
  quizEditSchema,
  quizPublishBlockers,
  questionListSchema,
  questionSchema,
  secondsFromMinutes,
  type QuizPublishCandidate,
} from "@/lib/admin/quiz-schema";

function form(overrides: Record<string, unknown> = {}) {
  return {
    slug: "acids-and-bases",
    title: "Acids and bases",
    description: "Ten questions on pH.",
    difficulty: "easy",
    category: "Fundamentals",
    position: "10",
    timeLimitMinutes: "",
    passMarkPercent: "60",
    maxAttempts: "",
    shuffleQuestions: null,
    shuffleOptions: null,
    ...overrides,
  };
}

function question(overrides: Record<string, unknown> = {}) {
  return {
    prompt: "What is the pH of pure water at 25°C?",
    explanation: "Neutral water has equal H+ and OH- concentrations.",
    points: 1,
    options: [{ label: "7" }, { label: "1" }, { label: "14" }],
    correctIndex: 0,
    ...overrides,
  };
}

describe("sitting rules", () => {
  it("treats an empty time limit as untimed, not as zero minutes", () => {
    // Zero would be a different claim: no time at all.
    expect(quizEditSchema.parse(form()).timeLimitMinutes).toBeNull();
  });

  it("treats an empty attempt limit as unlimited", () => {
    expect(quizEditSchema.parse(form()).maxAttempts).toBeNull();
  });

  it.each(["0", "-5", "1.5", "abc", "601"])(
    "rejects %j as a time limit",
    (timeLimitMinutes) => {
      expect(quizEditSchema.safeParse(form({ timeLimitMinutes })).success).toBe(
        false,
      );
    },
  );

  it("accepts a pass mark of 0 and of 100, and refuses 101", () => {
    expect(
      quizEditSchema.parse(form({ passMarkPercent: "0" })).passMarkPercent,
    ).toBe(0);
    expect(
      quizEditSchema.parse(form({ passMarkPercent: "100" })).passMarkPercent,
    ).toBe(100);
    expect(
      quizEditSchema.safeParse(form({ passMarkPercent: "101" })).success,
    ).toBe(false);
  });

  it("reads a checkbox as on only when it is present", () => {
    expect(quizEditSchema.parse(form()).shuffleQuestions).toBe(false);
    expect(
      quizEditSchema.parse(form({ shuffleQuestions: "on" })).shuffleQuestions,
    ).toBe(true);
  });

  it("round-trips minutes through seconds", () => {
    for (const minutes of [1, 5, 30, 90, 600]) {
      expect(minutesFromSeconds(secondsFromMinutes(minutes))).toBe(minutes);
    }
    expect(secondsFromMinutes(null)).toBeNull();
    expect(minutesFromSeconds(null)).toBeNull();
  });
});

describe("a question", () => {
  it("accepts a well-formed one", () => {
    expect(questionListSchema.safeParse([question()]).success).toBe(true);
  });

  it(`needs at least ${MIN_OPTIONS} options`, () => {
    const result = questionListSchema.safeParse([
      question({ options: [{ label: "Only one" }] }),
    ]);
    expect(result.success).toBe(false);
  });

  it(`takes at most ${MAX_OPTIONS} options`, () => {
    const options = Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => ({
      label: `Option ${i}`,
    }));
    expect(questionListSchema.safeParse([question({ options })]).success).toBe(
      false,
    );
  });

  it("refuses an answer that points past the end of its own options", () => {
    // Stored, this is a question nobody can get right.
    const result = questionListSchema.safeParse([
      question({ correctIndex: 5 }),
    ]);
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) =>
        issue.path.join(".").endsWith("correctIndex"),
      ),
    ).toBe(true);
  });

  it("refuses an unmarked answer", () => {
    expect(
      questionListSchema.safeParse([question({ correctIndex: -1 })]).success,
    ).toBe(false);
  });

  it("refuses two options that read the same", () => {
    // One of them cannot be marked as the answer, and a student who picks the
    // "wrong" copy of the right answer is marked down for our data entry.
    const result = questionListSchema.safeParse([
      question({
        options: [{ label: "7" }, { label: "  seven " }, { label: "Seven" }],
      }),
    ]);
    expect(result.success).toBe(false);
  });

  it("refuses a blank option rather than storing an empty choice", () => {
    expect(
      questionListSchema.safeParse([
        question({ options: [{ label: "7" }, { label: "   " }] }),
      ]).success,
    ).toBe(false);
  });

  it("reports the failing question by index, so the editor can place it", () => {
    const result = questionListSchema.safeParse([
      question(),
      question({ prompt: "" }),
    ]);
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.path.slice(0, 2)).toEqual([1, "prompt"]);
  });

  it("defaults points to 1 and refuses zero or a fraction", () => {
    expect(questionSchema.parse(question({ points: "" })).points).toBe(1);
    expect(questionSchema.safeParse(question({ points: "0" })).success).toBe(
      false,
    );
    expect(questionSchema.safeParse(question({ points: "1.5" })).success).toBe(
      false,
    );
  });

  it("trims the prompt rather than rejecting surrounding whitespace", () => {
    expect(questionSchema.parse(question({ prompt: "  Why?  " })).prompt).toBe(
      "Why?",
    );
  });
});

describe("quizPublishBlockers", () => {
  const publishable: QuizPublishCandidate = {
    title: "Acids and bases",
    description: "Ten questions on pH.",
    category: "Fundamentals",
    questionCount: 10,
    unanswerableCount: 0,
    deletedAt: null,
  };

  it("allows a complete quiz", () => {
    expect(quizPublishBlockers(publishable)).toEqual([]);
  });

  it("refuses a quiz with no questions", () => {
    // The criterion from #16.
    expect(quizPublishBlockers({ ...publishable, questionCount: 0 })).toEqual([
      "noQuestions",
    ]);
  });

  it("refuses a quiz containing a question nobody can pass", () => {
    expect(
      quizPublishBlockers({ ...publishable, unanswerableCount: 1 }),
    ).toEqual(["unanswerableQuestion"]);
  });

  it("refuses a withdrawn quiz", () => {
    expect(
      quizPublishBlockers({ ...publishable, deletedAt: new Date() }),
    ).toContain("deleted");
  });

  it("reports every reason at once, not the first one", () => {
    expect(
      quizPublishBlockers({
        title: " ",
        description: "",
        category: "",
        questionCount: 0,
        unanswerableCount: 2,
        deletedAt: null,
      }),
    ).toEqual([
      "missingTitle",
      "missingDescription",
      "missingCategory",
      "noQuestions",
      "unanswerableQuestion",
    ]);
  });
});

describe("ordering", () => {
  it("numbers a list contiguously from zero", () => {
    // A gap or a duplicate is either a constraint violation or a silently
    // reordered quiz.
    const positions = contiguousPositions(["a", "b", "c"]).map(
      (e) => e.position,
    );
    expect(positions).toEqual([0, 1, 2]);
  });

  it("moves an item without losing or duplicating any", () => {
    const list = ["a", "b", "c", "d"];
    expect(moved(list, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moved(list, 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moved(list, 1, 1)).toEqual(list);
  });

  it("leaves the list alone when the move is off the ends", () => {
    const list = ["a", "b"];
    // The buttons are disabled at the ends, but a keyboard repeat should not
    // be able to drop an item off the list.
    expect(moved(list, 0, -1)).toEqual(list);
    expect(moved(list, 1, 2)).toEqual(list);
    expect(moved(list, -1, 0)).toEqual(list);
  });

  it("does not mutate the list it is given", () => {
    const list = ["a", "b", "c"];
    moved(list, 0, 2);
    expect(list).toEqual(["a", "b", "c"]);
  });
});
