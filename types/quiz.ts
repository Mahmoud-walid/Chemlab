/**
 * The shape of `data/quiz.json` — the SEED INPUT, not the runtime model.
 *
 * The runtime model is the `quizzes` / `quiz_questions` / `quiz_options`
 * tables and the types in `db/queries/exams/attempts.ts`. What used to live
 * here as well — `QuizAttempt`, the `sessionStorage` result shape — is gone
 * with the client-side scoring it existed for.
 */
export type Difficulty = "easy" | "medium" | "hard";

export interface QuizQuestion {
  question: string;
  options: string[];
  answer: string; // must match one of options exactly
  explanation: string;
}

export interface Quiz {
  slug: string;
  title: string;
  description: string;
  difficulty: Difficulty;
  category: string;
  questions: QuizQuestion[];
}
