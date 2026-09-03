import { describe, expect, it } from "vitest";
import quizzes from "@/data/quiz.json";
import type { Quiz } from "@/types/quiz";

const data = quizzes as Quiz[];
const DIFFICULTIES = ["easy", "medium", "hard"];

describe("data/quiz.json", () => {
  it("is a non-empty list of quizzes", () => {
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  it("has unique slugs", () => {
    const slugs = data.map((q) => q.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it.each(data.map((q) => [q.slug, q] as const))(
    "%s has valid metadata",
    (slug, quiz) => {
      expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(quiz.title.trim()).not.toBe("");
      expect(quiz.description.trim()).not.toBe("");
      expect(quiz.category.trim()).not.toBe("");
      expect(DIFFICULTIES).toContain(quiz.difficulty);
      expect(quiz.questions.length).toBeGreaterThan(0);
    },
  );

  it.each(data.map((q) => [q.slug, q] as const))(
    "%s has well-formed questions",
    (_slug, quiz) => {
      for (const question of quiz.questions) {
        expect(question.question.trim()).not.toBe("");
        expect(question.explanation.trim()).not.toBe("");
        // At least two options, all distinct.
        expect(question.options.length).toBeGreaterThanOrEqual(2);
        expect(new Set(question.options).size).toBe(question.options.length);
        // The answer must match one of the options exactly.
        expect(question.options).toContain(question.answer);
      }
    },
  );

  it("has unique question text within each quiz", () => {
    for (const quiz of data) {
      const questions = quiz.questions.map((q) => q.question);
      expect(
        new Set(questions).size,
        `duplicate question in ${quiz.slug}`,
      ).toBe(questions.length);
    }
  });
});
