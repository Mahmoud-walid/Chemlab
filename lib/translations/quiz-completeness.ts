/**
 * Whether a quiz translation is complete enough to submit for review.
 *
 * The rule that has no lesson equivalent: a QUESTION and its options are one
 * unit. Translating a question's prompt and three of its four options is not
 * three quarters of a question — it is a question nobody can answer, and the
 * reader-side `chooseForGroup` in `db/queries/_locale.ts` deals with it by
 * serving the whole question in English.
 *
 * That fallback is correct and it is also invisible: an editor who submits a
 * partly translated question sees no error anywhere, and their work simply
 * never reaches a reader. So the incompleteness is caught HERE, at the point
 * where somebody is about to declare it ready, rather than discovered later
 * by a reader who cannot answer question 3.
 *
 * A pure function over what the form holds. It knows nothing about the
 * database, so the same rule can disable a button and refuse a submission
 * without either being a re-implementation of the other.
 */

export interface QuestionDraft {
  id: string;
  prompt: string;
  explanation: string;
  options: { id: string; label: string }[];
}

/** Which part of a question is not finished. */
export type IncompletePart = "prompt" | "explanation" | "options";

export interface IncompleteQuestion {
  id: string;
  /** 1-based, because it is shown to a person: "question 3", not "index 2". */
  number: number;
  parts: IncompletePart[];
}

const blank = (value: string) => value.trim() === "";

/**
 * Every question that is not finished, and which part of it.
 *
 * All of them, not the first: an editor who fixes one and is then told about
 * the next has been made to discover the rules one submission at a time.
 *
 * A question with NO options is complete once its prompt and explanation are
 * written. That is not a loophole — a question with no options cannot be
 * published at all (`quizPublishBlockers` calls it unanswerable), so refusing
 * the translation as well would report the same problem twice in the wrong
 * vocabulary.
 */
export function incompleteQuestions(
  questions: QuestionDraft[],
): IncompleteQuestion[] {
  const found: IncompleteQuestion[] = [];

  questions.forEach((question, index) => {
    const parts: IncompletePart[] = [];

    if (blank(question.prompt)) parts.push("prompt");
    if (blank(question.explanation)) parts.push("explanation");
    // ANY blank option, not all of them: one untranslated choice among four
    // is the exact failure this whole rule exists for.
    if (question.options.some((option) => blank(option.label))) {
      parts.push("options");
    }

    if (parts.length > 0) {
      found.push({ id: question.id, number: index + 1, parts });
    }
  });

  return found;
}

/** True when every question is whole and the quiz's own fields are written. */
export function isSubmittable(
  quiz: { title: string; description: string },
  questions: QuestionDraft[],
): boolean {
  return (
    !blank(quiz.title) &&
    !blank(quiz.description) &&
    incompleteQuestions(questions).length === 0
  );
}
