import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";

import { getDb } from "@/db/client";
import {
  quizOptions,
  quizQuestionTranslations,
  quizQuestions,
  quizTranslations,
  quizzes,
} from "@/db/schema/content";
import type { Quiz, QuizQuestion } from "@/types/quiz";
import { preferred } from "./_locale";

export interface QuizSummary {
  slug: string;
  title: string;
  description: string;
  difficulty: "easy" | "medium" | "hard";
  category: string;
  questionCount: number;
  /** False when this locale has no translation row and the default copy is shown. */
  isTranslated: boolean;
}

/**
 * The quiz catalogue for one locale, with the question count computed in SQL.
 *
 * The count comes from a correlated subquery rather than from loading the
 * questions: the overview page shows "10 questions" and nothing else, so
 * fetching 60 question rows to call `.length` on them would be six joins for
 * six integers.
 */
export async function listQuizzes(locale: string): Promise<QuizSummary[]> {
  const db = getDb();
  const rows = await db
    .select({
      slug: quizzes.slug,
      title: quizzes.title,
      description: quizzes.description,
      difficulty: quizzes.difficulty,
      category: quizzes.category,
      translatedTitle: quizTranslations.title,
      translatedDescription: quizTranslations.description,
      questionCount: db.$count(
        quizQuestions,
        eq(quizQuestions.quizId, quizzes.id),
      ),
    })
    .from(quizzes)
    .leftJoin(
      quizTranslations,
      and(
        eq(quizTranslations.quizId, quizzes.id),
        eq(quizTranslations.locale, locale),
      ),
    )
    // Draft, archived and soft-deleted quizzes keep their rows but must not
    // be listed. The status column is the single answer to "is this live" —
    // `published_at` only records when it first became so.
    .where(and(eq(quizzes.status, "published"), isNull(quizzes.deletedAt)))
    // Catalogue order first, slug as the tiebreak so the list is stable
    // between requests rather than following Postgres' physical row order.
    .orderBy(asc(quizzes.position), asc(quizzes.slug));

  return rows.map((row) => ({
    slug: row.slug,
    title: preferred(row.translatedTitle, row.title),
    description: preferred(row.translatedDescription, row.description),
    difficulty: row.difficulty,
    category: row.category,
    questionCount: Number(row.questionCount),
    isTranslated: row.translatedTitle !== null,
  }));
}

/**
 * One quiz with its questions and options, or null when the slug matches
 * nothing.
 *
 * Two queries, not one: a single join of quiz × questions × options returns
 * the quiz row repeated once per option, and reassembling that is more code
 * than a second round trip costs. Options come back in stored `position`
 * order — shuffling is a display decision the quiz page makes, which is what
 * lets a resumed attempt show the same order.
 *
 * NOTE: the returned shape still carries `answer`, so a client component
 * rendering it ships the answer key to the browser. That predates this change
 * — see #26, which moves grading to the server.
 */
export async function getQuizBySlug(
  slug: string,
  locale: string,
): Promise<Quiz | null> {
  const db = getDb();

  const [quiz] = await db
    .select({
      id: quizzes.id,
      slug: quizzes.slug,
      title: quizzes.title,
      description: quizzes.description,
      difficulty: quizzes.difficulty,
      category: quizzes.category,
      translatedTitle: quizTranslations.title,
      translatedDescription: quizTranslations.description,
    })
    .from(quizzes)
    .leftJoin(
      quizTranslations,
      and(
        eq(quizTranslations.quizId, quizzes.id),
        eq(quizTranslations.locale, locale),
      ),
    )
    .where(
      and(
        eq(quizzes.slug, slug),
        eq(quizzes.status, "published"),
        isNull(quizzes.deletedAt),
      ),
    )
    .limit(1);

  if (!quiz) return null;

  const rows = await db
    .select({
      questionId: quizQuestions.id,
      questionPosition: quizQuestions.position,
      prompt: quizQuestions.prompt,
      explanation: quizQuestions.explanation,
      correctOptionId: quizQuestions.correctOptionId,
      translatedPrompt: quizQuestionTranslations.prompt,
      translatedExplanation: quizQuestionTranslations.explanation,
      optionId: quizOptions.id,
      label: quizOptions.label,
    })
    .from(quizQuestions)
    .innerJoin(quizOptions, eq(quizOptions.questionId, quizQuestions.id))
    .leftJoin(
      quizQuestionTranslations,
      and(
        eq(quizQuestionTranslations.questionId, quizQuestions.id),
        eq(quizQuestionTranslations.locale, locale),
      ),
    )
    .where(eq(quizQuestions.quizId, quiz.id))
    .orderBy(asc(quizQuestions.position), asc(quizOptions.position));

  const byQuestion = new Map<string, QuizQuestion>();
  for (const row of rows) {
    let question = byQuestion.get(row.questionId);
    if (!question) {
      question = {
        question: preferred(row.translatedPrompt, row.prompt),
        options: [],
        answer: "",
        explanation: preferred(row.translatedExplanation, row.explanation),
      };
      byQuestion.set(row.questionId, question);
    }
    question.options.push(row.label);
    // The answer is a reference, so it is resolved rather than trusted: the
    // string is whichever option the FK actually points at.
    if (row.optionId === row.correctOptionId) question.answer = row.label;
  }

  const questions = [...byQuestion.values()];
  // A question whose correct_option_id resolved to nothing would silently
  // become unanswerable. The seed asserts this too; failing loudly here means
  // a hand-edited row cannot ship a broken quiz.
  const unanswerable = questions.filter((q) => q.answer === "");
  if (unanswerable.length > 0) {
    throw new Error(
      `Quiz "${slug}" has ${unanswerable.length} question(s) whose correct option is missing.`,
    );
  }

  return {
    slug: quiz.slug,
    title: preferred(quiz.translatedTitle, quiz.title),
    description: preferred(quiz.translatedDescription, quiz.description),
    difficulty: quiz.difficulty,
    category: quiz.category,
    questions,
  };
}

/** Slugs only — for `generateStaticParams` and the sitemap. */
export async function listQuizSlugs(): Promise<string[]> {
  const rows = await getDb()
    .select({ slug: quizzes.slug })
    .from(quizzes)
    .where(and(eq(quizzes.status, "published"), isNull(quizzes.deletedAt)))
    .orderBy(asc(quizzes.position), asc(quizzes.slug));
  return rows.map((row) => row.slug);
}
