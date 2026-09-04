import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAttempts,
  getAttemptBySlug,
  getAttempts,
  gradeLabel,
  percentage,
  saveAttempt,
} from "@/lib/quiz-storage";
import type { QuizAttempt } from "@/types/quiz";

const STORAGE_KEY = "chemlab_quiz_results";

function makeAttempt(overrides: Partial<QuizAttempt> = {}): QuizAttempt {
  return {
    slug: "periodic-table-basics",
    title: "Periodic Table Basics",
    difficulty: "easy",
    score: 4,
    total: 5,
    completedAt: "2026-01-01T00:00:00.000Z",
    answers: [
      {
        question: "What is the chemical symbol for Gold?",
        chosen: "Au",
        correct: "Au",
        isCorrect: true,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  sessionStorage.clear();
});

describe("getAttempts", () => {
  it("returns an empty array when nothing is stored", () => {
    expect(getAttempts()).toEqual([]);
  });

  it("returns stored attempts", () => {
    const attempt = makeAttempt();
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([attempt]));
    expect(getAttempts()).toEqual([attempt]);
  });

  it("returns an empty array when the stored value is not valid JSON", () => {
    sessionStorage.setItem(STORAGE_KEY, "{not json");
    expect(getAttempts()).toEqual([]);
  });

  it("returns an empty array when sessionStorage throws", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("access denied");
      });
    expect(getAttempts()).toEqual([]);
    spy.mockRestore();
  });
});

describe("saveAttempt", () => {
  it("persists an attempt", () => {
    const attempt = makeAttempt();
    saveAttempt(attempt);
    expect(getAttempts()).toEqual([attempt]);
  });

  it("keeps only the newest attempt per slug", () => {
    saveAttempt(makeAttempt({ score: 1 }));
    saveAttempt(makeAttempt({ score: 5 }));

    const attempts = getAttempts();
    expect(attempts).toHaveLength(1);
    expect(attempts[0].score).toBe(5);
  });

  it("stores the newest attempt first and keeps other slugs", () => {
    saveAttempt(makeAttempt({ slug: "acids-and-bases" }));
    saveAttempt(makeAttempt({ slug: "periodic-table-basics" }));

    expect(getAttempts().map((a) => a.slug)).toEqual([
      "periodic-table-basics",
      "acids-and-bases",
    ]);
  });
});

describe("getAttemptBySlug", () => {
  it("finds a stored attempt", () => {
    saveAttempt(makeAttempt({ slug: "acids-and-bases" }));
    expect(getAttemptBySlug("acids-and-bases")?.slug).toBe("acids-and-bases");
  });

  it("returns null for an unknown slug", () => {
    saveAttempt(makeAttempt());
    expect(getAttemptBySlug("does-not-exist")).toBeNull();
  });
});

describe("clearAttempts", () => {
  it("removes every stored attempt", () => {
    saveAttempt(makeAttempt());
    clearAttempts();
    expect(getAttempts()).toEqual([]);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe("percentage", () => {
  it("returns 0 when there are no questions (no divide by zero)", () => {
    expect(percentage(0, 0)).toBe(0);
  });

  it.each([
    [0, 10, 0],
    [5, 10, 50],
    [10, 10, 100],
    [1, 3, 33],
    [2, 3, 67],
  ])("scores %i/%i as %i%%", (score, total, expected) => {
    expect(percentage(score, total)).toBe(expected);
  });
});

describe("gradeLabel", () => {
  it.each([
    [100, "excellent"],
    [90, "excellent"],
    [89, "good"],
    [75, "good"],
    [74, "needsWork"],
    [50, "needsWork"],
    [49, "keepStudying"],
    [0, "keepStudying"],
  ])("grades %i%% as %s", (pct, key) => {
    expect(gradeLabel(pct).key).toBe(key);
  });

  it("returns a translation key, never a display string", () => {
    // A display string here is what made the results page untranslatable.
    for (const pct of [0, 50, 75, 90]) {
      expect(gradeLabel(pct).key).toMatch(/^[a-z][a-zA-Z]*$/);
    }
  });

  it("returns a class name for styling with every label", () => {
    for (const pct of [0, 49, 50, 74, 75, 89, 90, 100]) {
      expect(gradeLabel(pct).className).not.toBe("");
    }
  });
});
