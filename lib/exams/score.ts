/**
 * Scoring, as a pure function over rows.
 *
 * Separated from the database on purpose. Scoring is the one calculation in
 * the product a student has a reason to dispute, so it has to be testable
 * exhaustively — every question type, partial credit on and off, unanswered
 * questions, a quiz with no questions at all — without a connection.
 *
 * It is also the reason the client never computes a score. `isCorrect`,
 * `pointsAwarded`, `score` and `passed` are outputs of this function applied
 * to rows the server read; a submission carrying any of them is a bug or an
 * attack, and the action rejects it rather than ignoring it.
 */

export type QuestionType = "single_choice" | "multiple_choice";

export interface ScorableQuestion {
  id: string;
  type: QuestionType;
  points: number;
  /** Whether a partly-right multiple choice earns part of the marks. */
  partialCredit: boolean;
  correctOptionIds: string[];
}

/** What the candidate chose. A question with no entry is unanswered. */
export type Submission = Record<string, string[]>;

export interface QuestionOutcome {
  questionId: string;
  /** True only for a fully correct answer, whatever the credit policy. */
  isCorrect: boolean;
  pointsAwarded: number;
  maxPoints: number;
}

export interface ScoreResult {
  outcomes: QuestionOutcome[];
  score: number;
  maxScore: number;
  /** 0–100, rounded. A quiz with no questions scores 0, not NaN. */
  percent: number;
  passed: boolean;
}

/**
 * One question's marks.
 *
 * Multiple choice with partial credit uses
 * `(correct chosen − incorrect chosen) / total correct`, floored at zero.
 * All-or-nothing was the alternative and is worse: on a 2-of-4 question,
 * selecting all four options is right about as often as answering carefully,
 * and this formula makes a wrong tick cost exactly what a right one earns.
 */
export function scoreQuestion(
  question: ScorableQuestion,
  selected: string[] | undefined,
): QuestionOutcome {
  const maxPoints = question.points;
  const chosen = new Set(selected ?? []);
  const correct = new Set(question.correctOptionIds);

  // Unanswered is zero, and is not the same as answered-wrong: the caller can
  // tell them apart by the absence of a submission entry, which is what the
  // per-question analytics need.
  if (chosen.size === 0) {
    return {
      questionId: question.id,
      isCorrect: false,
      pointsAwarded: 0,
      maxPoints,
    };
  }

  const hits = [...chosen].filter((id) => correct.has(id)).length;
  const misses = chosen.size - hits;
  const exact = hits === correct.size && misses === 0;

  if (question.type === "single_choice") {
    // More than one selection on a single-choice question is not a partial
    // answer — it is a malformed one, and scoring it as "one of these is
    // right" would let a candidate tick every option.
    const ok = exact && chosen.size === 1;
    return {
      questionId: question.id,
      isCorrect: ok,
      pointsAwarded: ok ? maxPoints : 0,
      maxPoints,
    };
  }

  if (exact) {
    return {
      questionId: question.id,
      isCorrect: true,
      pointsAwarded: maxPoints,
      maxPoints,
    };
  }

  if (!question.partialCredit) {
    return {
      questionId: question.id,
      isCorrect: false,
      pointsAwarded: 0,
      maxPoints,
    };
  }

  // A question with no correct option recorded is an authoring error, not a
  // free mark: dividing by zero here would award full points to everyone.
  const fraction =
    correct.size === 0 ? 0 : Math.max(0, (hits - misses) / correct.size);
  return {
    questionId: question.id,
    isCorrect: false,
    pointsAwarded: Math.round(fraction * maxPoints),
    maxPoints,
  };
}

/** The whole paper. */
export function scoreAttempt(
  questions: ScorableQuestion[],
  submission: Submission,
  passMarkPercent: number,
): ScoreResult {
  const outcomes = questions.map((question) =>
    scoreQuestion(question, submission[question.id]),
  );

  const score = outcomes.reduce((total, one) => total + one.pointsAwarded, 0);
  const maxScore = outcomes.reduce((total, one) => total + one.maxPoints, 0);

  return {
    outcomes,
    score,
    maxScore,
    percent: percentage(score, maxScore),
    // A quiz with nothing in it cannot be passed. Treating 0/0 as 100% would
    // mark an empty draft as a pass for everybody who opened it.
    passed: maxScore > 0 && percentage(score, maxScore) >= passMarkPercent,
  };
}

/** Rounded percent, guarding the empty case. */
export function percentage(score: number, maxScore: number): number {
  if (maxScore <= 0) return 0;
  return Math.round((score / maxScore) * 100);
}

/**
 * The band a percentage falls in, as a message KEY rather than English.
 *
 * The old `gradeLabel()` returned "Excellent!" from a lib module, which put an
 * English string into an Arabic page with no way for next-intl to reach it.
 */
export function gradeKey(percent: number): string {
  if (percent >= 90) return "excellent";
  if (percent >= 75) return "good";
  if (percent >= 60) return "fair";
  return "needsWork";
}
