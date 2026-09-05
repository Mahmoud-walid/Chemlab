import { z } from "zod";

import { lessonSlug } from "./lesson-schema";

/**
 * Validation and lifecycle rules for the quiz editor, shared by the form and
 * the server actions.
 *
 * Pure — no database, no `server-only` — so the rules can be tested directly
 * and the same schema can run in the browser for immediate feedback.
 */

/** A whole number from a form field, or null when the field is left empty. */
const optionalCount = (max: number, message: string) =>
  z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((value) => {
      if (value === null || value === undefined) return null;
      if (typeof value === "number") return value;
      const trimmed = value.trim();
      if (trimmed === "") return null;
      return Number(trimmed);
    })
    .refine(
      (value) =>
        value === null ||
        (Number.isInteger(value) && value > 0 && value <= max),
      { message },
    );

/** A checkbox: present in the payload means on, absent means off. */
const checkbox = z
  .union([z.string(), z.boolean(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value === "boolean") return value;
    return value === "on" || value === "true";
  });

export const quizEditSchema = z.object({
  // Quizzes and lessons share a slug shape for the same reason: it is a public
  // URL segment either way, and two spellings of the same rule is one of them
  // being wrong.
  slug: lessonSlug,
  title: z
    .string()
    .trim()
    .min(1, { message: "Enter a title." })
    .max(160, { message: "Titles are at most 160 characters." }),
  description: z
    .string()
    .trim()
    .min(1, { message: "Enter a description." })
    .max(500, { message: "Descriptions are at most 500 characters." }),
  difficulty: z.enum(["easy", "medium", "hard"], {
    message: "Choose easy, medium or hard.",
  }),
  category: z
    .string()
    .trim()
    .min(1, { message: "Enter a category." })
    .max(80, { message: "Categories are at most 80 characters." }),
  position: z
    .union([z.string(), z.number()])
    .transform((value) =>
      typeof value === "number" ? value : Number(String(value).trim() || "0"),
    )
    .refine(
      (value) => Number.isInteger(value) && value >= 0 && value <= 10000,
      { message: "Position is a whole number between 0 and 10000." },
    ),

  /**
   * Edited in minutes, stored in seconds.
   *
   * Nobody sets a time limit in seconds, and nobody reading "3600" checks the
   * arithmetic. The column stays in seconds because that is what a timer
   * counts down.
   */
  timeLimitMinutes: optionalCount(
    600,
    "A time limit is a whole number of minutes, up to 600. Leave it empty for no limit.",
  ),
  passMarkPercent: z
    .union([z.string(), z.number()])
    .transform((value) =>
      typeof value === "number" ? value : Number(String(value).trim() || "60"),
    )
    .refine((value) => Number.isInteger(value) && value >= 0 && value <= 100, {
      message: "The pass mark is a whole percentage between 0 and 100.",
    }),
  maxAttempts: optionalCount(
    100,
    "An attempt limit is a whole number above zero. Leave it empty for unlimited.",
  ),
  shuffleQuestions: checkbox,
  shuffleOptions: checkbox,
});

export type QuizEditInput = z.infer<typeof quizEditSchema>;

/** Minutes as typed, seconds as stored. One place, so the two cannot drift. */
export function secondsFromMinutes(minutes: number | null): number | null {
  return minutes === null ? null : minutes * 60;
}

export function minutesFromSeconds(seconds: number | null): number | null {
  return seconds === null ? null : Math.round(seconds / 60);
}

// ── Questions ───────────────────────────────────────────────────────────────

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 8;

/**
 * One question as the editor posts it.
 *
 * `id` is absent for a question the author has just added and present for one
 * already stored — that is how the save distinguishes an insert from an update
 * without asking the client to say which.
 *
 * The correct answer is an INDEX into `options`, not an option id: a
 * newly-added option has no id yet, and making the author save twice before
 * they can mark the right answer would be an artefact of our storage rather
 * than anything about the question.
 */
export const questionSchema = z.object({
  id: z.string().uuid().optional(),
  prompt: z
    .string()
    .trim()
    .min(1, { message: "Enter the question." })
    .max(1000, { message: "Questions are at most 1000 characters." }),
  explanation: z
    .string()
    .trim()
    .min(1, { message: "Enter an explanation." })
    .max(2000, { message: "Explanations are at most 2000 characters." }),
  points: z
    .union([z.string(), z.number()])
    .transform((value) =>
      typeof value === "number" ? value : Number(String(value).trim() || "1"),
    )
    .refine((value) => Number.isInteger(value) && value >= 1 && value <= 100, {
      message: "Points are a whole number between 1 and 100.",
    }),
  options: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        label: z
          .string()
          .trim()
          .min(1, { message: "An option cannot be blank." })
          .max(500, { message: "Options are at most 500 characters." }),
      }),
    )
    .min(MIN_OPTIONS, {
      message: `A question needs at least ${MIN_OPTIONS} options.`,
    })
    .max(MAX_OPTIONS, {
      message: `A question takes at most ${MAX_OPTIONS} options.`,
    }),
  correctIndex: z
    .union([z.string(), z.number()])
    .transform((value) =>
      typeof value === "number" ? value : Number(String(value).trim()),
    ),
});

export const questionListSchema = z
  .array(questionSchema)
  .superRefine((questions, ctx) => {
    questions.forEach((question, index) => {
      // Checked here rather than inside the question schema because it is a
      // relationship BETWEEN two fields: the answer has to name an option that
      // exists. A question whose answer points past the end of its own options
      // is unanswerable, and it would be stored without complaint.
      if (
        !Number.isInteger(question.correctIndex) ||
        question.correctIndex < 0 ||
        question.correctIndex >= question.options.length
      ) {
        ctx.addIssue({
          code: "custom",
          path: [index, "correctIndex"],
          message: "Mark which option is the correct answer.",
        });
      }

      // Two identical options make one of them unmarkable as the answer, and a
      // student who picks the "wrong" copy of the right answer is marked down
      // for our data entry.
      const seen = new Set<string>();
      question.options.forEach((option, optionIndex) => {
        const key = option.label.toLowerCase();
        if (seen.has(key)) {
          ctx.addIssue({
            code: "custom",
            path: [index, "options", optionIndex, "label"],
            message: "Two options are the same.",
          });
        }
        seen.add(key);
      });
    });
  });

export type QuestionInput = z.infer<typeof questionSchema>;

// ── Publication ─────────────────────────────────────────────────────────────

export type QuizPublishBlocker =
  | "missingTitle"
  | "missingDescription"
  | "missingCategory"
  | "noQuestions"
  | "unanswerableQuestion"
  | "deleted";

export interface QuizPublishCandidate {
  title: string;
  description: string;
  category: string;
  questionCount: number;
  /** Questions whose `correct_option_id` resolves to nothing. */
  unanswerableCount: number;
  deletedAt: Date | null;
}

/** Why a quiz cannot be published yet, as message keys. Empty means it can. */
export function quizPublishBlockers(
  quiz: QuizPublishCandidate,
): QuizPublishBlocker[] {
  const blockers: QuizPublishBlocker[] = [];

  if (quiz.deletedAt !== null) blockers.push("deleted");
  if (quiz.title.trim() === "") blockers.push("missingTitle");
  if (quiz.description.trim() === "") blockers.push("missingDescription");
  if (quiz.category.trim() === "") blockers.push("missingCategory");
  // The criterion from #16: a quiz with zero questions cannot publish.
  if (quiz.questionCount === 0) blockers.push("noQuestions");
  // And one nobody can pass is worse than one nobody can start.
  if (quiz.unanswerableCount > 0) blockers.push("unanswerableQuestion");

  return blockers;
}

/**
 * Renumbers a list to a contiguous 0..n-1 sequence.
 *
 * The stored `position` is what ORDER BY reads, and the unique index on
 * (parent, position) means a gap or a duplicate is either a constraint
 * violation or a silently reordered quiz. Reordering in the UI is a list
 * operation; this is the one place that turns it back into positions.
 */
export function contiguousPositions<T>(
  items: T[],
): { item: T; position: number }[] {
  return items.map((item, position) => ({ item, position }));
}

/** Moves an item within a list, returning a new list. */
export function moved<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0) return items;
  if (from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
