import { describe, expect, it } from "vitest";

import {
  incompleteQuestions,
  isSubmittable,
  type QuestionDraft,
} from "@/lib/translations/quiz-completeness";

/**
 * The rule that catches a partly translated question before a reader does.
 *
 * A question with three of four options translated renders in English, by
 * `chooseForGroup`, with no error anywhere — so an editor's work disappears
 * silently. This is the check that makes it loud.
 */

const whole = (id: string): QuestionDraft => ({
  id,
  prompt: "ما هو الحمض؟",
  explanation: "لأنه يمنح بروتونًا.",
  options: [
    { id: `${id}-a`, label: "مانح للبروتون" },
    { id: `${id}-b`, label: "مستقبل للبروتون" },
  ],
});

describe("incompleteQuestions", () => {
  it("finds nothing when every question is whole", () => {
    expect(incompleteQuestions([whole("q1"), whole("q2")])).toEqual([]);
  });

  it("catches ONE untranslated option among several", () => {
    // The whole point. Three of four is not three quarters of a question.
    const partial = whole("q1");
    partial.options.push({ id: "q1-c", label: "   " });

    expect(incompleteQuestions([partial])).toEqual([
      { id: "q1", number: 1, parts: ["options"] },
    ]);
  });

  it("names the question by its 1-based number, because a person reads it", () => {
    const broken = { ...whole("q3"), prompt: "" };
    expect(incompleteQuestions([whole("q1"), whole("q2"), broken])).toEqual([
      { id: "q3", number: 3, parts: ["prompt"] },
    ]);
  });

  it("reports every unfinished part of a question at once", () => {
    // An editor who clears one and is then told about the next has been made
    // to discover the rules one submission at a time.
    const empty: QuestionDraft = {
      id: "q1",
      prompt: "",
      explanation: "  ",
      options: [{ id: "a", label: "" }],
    };
    expect(incompleteQuestions([empty])[0]?.parts).toEqual([
      "prompt",
      "explanation",
      "options",
    ]);
  });

  it("reports every unfinished question, not just the first", () => {
    const a = { ...whole("q1"), prompt: "" };
    const b = { ...whole("q2"), explanation: "" };
    expect(incompleteQuestions([a, b]).map((q) => q.id)).toEqual(["q1", "q2"]);
  });

  it("treats whitespace as untranslated", () => {
    // A box someone tabbed through is not a translation.
    const spaces = { ...whole("q1"), prompt: "\n \t " };
    expect(incompleteQuestions([spaces])[0]?.parts).toEqual(["prompt"]);
  });

  it("accepts a question with no options at all", () => {
    // Not a loophole: a question with no options cannot be published anyway —
    // `quizPublishBlockers` calls it unanswerable. Refusing the translation
    // too would report the same problem twice in the wrong vocabulary.
    expect(incompleteQuestions([{ ...whole("q1"), options: [] }])).toEqual([]);
  });
});

describe("isSubmittable", () => {
  const quiz = { title: "الأحماض", description: "اختبار قصير" };

  it("accepts a whole translation", () => {
    expect(isSubmittable(quiz, [whole("q1")])).toBe(true);
  });

  it("refuses when the quiz's own fields are blank", () => {
    expect(isSubmittable({ title: "", description: "x" }, [whole("q1")])).toBe(
      false,
    );
    expect(isSubmittable({ title: "x", description: " " }, [whole("q1")])).toBe(
      false,
    );
  });

  it("refuses when any question is unfinished", () => {
    const partial = whole("q1");
    partial.options[1]!.label = "";
    expect(isSubmittable(quiz, [whole("q0"), partial])).toBe(false);
  });

  it("accepts a quiz with no questions yet", () => {
    // Nothing left untranslated. Whether it can be PUBLISHED as a quiz is a
    // different question, answered by `quizPublishBlockers`.
    expect(isSubmittable(quiz, [])).toBe(true);
  });
});
