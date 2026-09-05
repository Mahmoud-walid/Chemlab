import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";

import { getDb } from "@/db/client";
import { quizQuestions, quizTranslations, quizzes } from "@/db/schema/content";
import { chooseTranslation, pick, usesTranslation } from "./_locale";
import { translationState } from "./translations";

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
      ...translationState(quizTranslations, quizzes),
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

  return rows.map((row) => {
    // `assessed`, not `prose`, for everything a quiz shows. A quiz page has
    // nowhere to put a "may be out of date" notice, and a stale question is a
    // wrong question rather than a slightly old one — so quiz copy falls back
    // to the default locale instead of being served with a caveat.
    const state = {
      status: row.translationStatus,
      stale: row.translationStale,
    };
    // Computed once, so the flag the UI reads and the copy it renders can
    // never disagree about which locale the reader is looking at.
    const translated = usesTranslation(
      chooseTranslation(
        { present: row.translatedTitle !== null, ...state },
        "assessed",
      ),
    );
    return {
      slug: row.slug,
      title: pick(row.title, row.translatedTitle, state, "assessed"),
      description: pick(
        row.description,
        row.translatedDescription,
        state,
        "assessed",
      ),
      difficulty: row.difficulty,
      category: row.category,
      questionCount: Number(row.questionCount),
      isTranslated: translated,
    };
  });
}

/**
 * `getQuizBySlug` used to live here.
 *
 * It returned every question with its answer and its explanation, and it fed
 * the client-side quiz runner — which is how the whole answer key ended up in
 * the browser bundle. The exam engine replaced it with two narrower reads:
 * `getQuizIntro` for the page that offers a Start button, and `getPaper` for
 * the sitting itself, which names its columns so the key cannot be included
 * by accident. It is deleted rather than deprecated: a function that returns
 * the answers is a loaded gun for whoever next needs "the quiz".
 */

/** Slugs only — for `generateStaticParams` and the sitemap. */
export async function listQuizSlugs(): Promise<string[]> {
  const rows = await getDb()
    .select({ slug: quizzes.slug })
    .from(quizzes)
    .where(and(eq(quizzes.status, "published"), isNull(quizzes.deletedAt)))
    .orderBy(asc(quizzes.position), asc(quizzes.slug));
  return rows.map((row) => row.slug);
}
