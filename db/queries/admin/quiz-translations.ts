import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import {
  quizOptionTranslations,
  quizOptions,
  quizQuestionTranslations,
  quizQuestions,
  quizTranslations,
  quizzes,
} from "@/db/schema/content";
import type { TranslationState } from "@/lib/translations/state";
import { currentSourceHash } from "@/db/queries/translations";

/**
 * Reading and writing one quiz's translation into one locale.
 *
 * The lesson twin of this file explains the shape: source and translation
 * fetched together, always, because a translator working from a screen that
 * does not show the English is translating from memory.
 *
 * What is different is the depth. A lesson is two levels — lesson, sections.
 * A quiz is three — quiz, questions, OPTIONS — and the third is why this file
 * exists at all: without a translated option label, a translated quiz renders
 * an Arabic question above English answers, which is worse than serving the
 * whole thing in English because the reader cannot tell whether they got it
 * wrong or merely could not read the choices.
 *
 * `is_correct` never appears here. Which option is right is not a property of
 * the language it is written in, and there is no column on
 * `quiz_option_translations` to put it in even if somebody tried.
 */

export interface TranslatableOption {
  id: string;
  position: number;
  label: string;
  translatedLabel: string | null;
  state: TranslationState;
}

export interface TranslatableQuestion {
  id: string;
  position: number;
  prompt: string;
  explanation: string;
  translatedPrompt: string | null;
  translatedExplanation: string | null;
  state: TranslationState;
  options: TranslatableOption[];
}

export interface QuizTranslationView {
  quizId: string;
  slug: string;
  locale: string;
  /** The default-locale copy, shown beside every box. */
  source: { title: string; description: string };
  /** What exists for this locale, or null if nobody has started. */
  translation: {
    title: string;
    description: string;
    status: "draft" | "in_review" | "published";
    stale: boolean;
  } | null;
  questions: TranslatableQuestion[];
}

/** The five states a row can be in, from one translation row's columns. */
function stateOf(
  translationId: string | null,
  status: "draft" | "in_review" | "published" | null,
  stale: boolean | null,
): TranslationState {
  if (!translationId) return "missing";
  if (status === "draft") return "draft";
  if (status === "in_review") return "in_review";
  return stale ? "stale" : "published";
}

export async function getQuizTranslation(
  slug: string,
  locale: string,
): Promise<QuizTranslationView | null> {
  const db = getDb();

  const [quiz] = await db
    .select({
      id: quizzes.id,
      slug: quizzes.slug,
      title: quizzes.title,
      description: quizzes.description,
      translatedTitle: quizTranslations.title,
      translatedDescription: quizTranslations.description,
      status: quizTranslations.status,
      translationId: quizTranslations.id,
      stale: sql<boolean>`${quizTranslations.sourceHash} is distinct from ${quizzes.sourceHash}`,
    })
    .from(quizzes)
    .leftJoin(
      quizTranslations,
      and(
        eq(quizTranslations.quizId, quizzes.id),
        eq(quizTranslations.locale, locale),
      ),
    )
    .where(eq(quizzes.slug, slug))
    .limit(1);

  if (!quiz) return null;

  const questionRows = await db
    .select({
      id: quizQuestions.id,
      position: quizQuestions.position,
      prompt: quizQuestions.prompt,
      explanation: quizQuestions.explanation,
      translatedPrompt: quizQuestionTranslations.prompt,
      translatedExplanation: quizQuestionTranslations.explanation,
      status: quizQuestionTranslations.status,
      translationId: quizQuestionTranslations.id,
      stale: sql<boolean>`${quizQuestionTranslations.sourceHash} is distinct from ${quizQuestions.sourceHash}`,
    })
    .from(quizQuestions)
    .leftJoin(
      quizQuestionTranslations,
      and(
        eq(quizQuestionTranslations.questionId, quizQuestions.id),
        eq(quizQuestionTranslations.locale, locale),
      ),
    )
    .where(eq(quizQuestions.quizId, quiz.id))
    .orderBy(asc(quizQuestions.position));

  // One query for every option in the quiz, not one per question: a quiz with
  // twenty questions would otherwise be twenty round trips to render a form.
  const optionRows = questionRows.length
    ? await db
        .select({
          id: quizOptions.id,
          questionId: quizOptions.questionId,
          position: quizOptions.position,
          label: quizOptions.label,
          translatedLabel: quizOptionTranslations.label,
          status: quizOptionTranslations.status,
          translationId: quizOptionTranslations.id,
          stale: sql<boolean>`${quizOptionTranslations.sourceHash} is distinct from ${quizOptions.sourceHash}`,
          // NOT `isCorrect`. The answer key has no business on a translation
          // screen: a translator needs to render the words, not know which is
          // right, and a form that carried it could post it back.
        })
        .from(quizOptions)
        .leftJoin(
          quizOptionTranslations,
          and(
            eq(quizOptionTranslations.optionId, quizOptions.id),
            eq(quizOptionTranslations.locale, locale),
          ),
        )
        .where(
          sql`${quizOptions.questionId} in (
            select id from ${quizQuestions} where quiz_id = ${quiz.id}
          )`,
        )
        .orderBy(asc(quizOptions.position))
    : [];

  return {
    quizId: quiz.id,
    slug: quiz.slug,
    locale,
    source: { title: quiz.title, description: quiz.description },
    translation: quiz.translationId
      ? {
          title: quiz.translatedTitle ?? "",
          description: quiz.translatedDescription ?? "",
          status: quiz.status ?? "draft",
          stale: Boolean(quiz.stale),
        }
      : null,
    questions: questionRows.map((row) => ({
      id: row.id,
      position: row.position,
      prompt: row.prompt,
      explanation: row.explanation,
      translatedPrompt: row.translatedPrompt,
      translatedExplanation: row.translatedExplanation,
      state: stateOf(row.translationId, row.status, row.stale),
      options: optionRows
        .filter((option) => option.questionId === row.id)
        .map((option) => ({
          id: option.id,
          position: option.position,
          label: option.label,
          translatedLabel: option.translatedLabel,
          state: stateOf(option.translationId, option.status, option.stale),
        })),
    })),
  };
}

export interface QuizTranslationInput {
  title: string;
  description: string;
  questions: {
    id: string;
    prompt: string;
    explanation: string;
    options: { id: string; label: string }[];
  }[];
}

/**
 * Writes a translation — quiz, questions and options — in one transaction.
 *
 * One transaction because a half-saved translation is worse than an unsaved
 * one: a question written into Arabic over options that were not is exactly
 * the mixed-language state the reader-side `chooseForGroup` exists to catch,
 * and catching it means falling back to English, so the translator's work
 * disappears from the page without an error.
 *
 * The status is not touched here. Saving text and deciding it is ready are
 * different acts with different permissions — see `setQuizTranslationStatus` —
 * and a save that quietly republished would let `translation:write` do what
 * `translation:review` is for.
 *
 * `source_hash` is always read back from the generated column in the same
 * statement. Never recomputed here: a second implementation of that hash is
 * how a whole catalogue silently reads as stale.
 */
export async function saveQuizTranslation(
  quizId: string,
  locale: string,
  input: QuizTranslationInput,
): Promise<void> {
  const db = getDb();

  await db.transaction(async (tx) => {
    await tx
      .insert(quizTranslations)
      .values({
        quizId,
        locale,
        title: input.title,
        description: input.description,
        sourceHash: currentSourceHash(quizzes, quizId),
      })
      .onConflictDoUpdate({
        target: [quizTranslations.quizId, quizTranslations.locale],
        set: {
          title: input.title,
          description: input.description,
          // Saved text is by definition made from the source as it stands, so
          // the save is also what clears "out of date".
          sourceHash: currentSourceHash(quizzes, quizId),
        },
      });

    for (const question of input.questions) {
      await tx
        .insert(quizQuestionTranslations)
        .values({
          questionId: question.id,
          locale,
          prompt: question.prompt,
          explanation: question.explanation,
          sourceHash: currentSourceHash(quizQuestions, question.id),
        })
        .onConflictDoUpdate({
          target: [
            quizQuestionTranslations.questionId,
            quizQuestionTranslations.locale,
          ],
          set: {
            prompt: question.prompt,
            explanation: question.explanation,
            sourceHash: currentSourceHash(quizQuestions, question.id),
          },
        });

      for (const option of question.options) {
        await tx
          .insert(quizOptionTranslations)
          .values({
            optionId: option.id,
            locale,
            label: option.label,
            sourceHash: currentSourceHash(quizOptions, option.id),
          })
          .onConflictDoUpdate({
            target: [
              quizOptionTranslations.optionId,
              quizOptionTranslations.locale,
            ],
            set: {
              label: option.label,
              sourceHash: currentSourceHash(quizOptions, option.id),
            },
          });
      }
    }
  });
}

/**
 * Moves a translation along its workflow — quiz, questions and options.
 *
 * Together, and for a sharper reason than the lesson version has. A published
 * question over draft options does not merely look inconsistent in the admin
 * column: `chooseForGroup` sees one unpublished member and serves the entire
 * question in English, so the translation an editor just published would be
 * invisible to every reader with no error anywhere to explain it.
 */
export async function setQuizTranslationStatus(
  quizId: string,
  locale: string,
  status: "draft" | "in_review" | "published",
  reviewedBy: string | null,
): Promise<void> {
  const db = getDb();
  const reviewed =
    status === "published"
      ? { reviewedBy, reviewedAt: new Date() }
      : // Sending something back to draft clears the sign-off with it. A row
        // that says "reviewed by" while sitting in draft is a claim nobody
        // made.
        { reviewedBy: null, reviewedAt: null };

  await db.transaction(async (tx) => {
    await tx
      .update(quizTranslations)
      .set({ status, ...reviewed })
      .where(
        and(
          eq(quizTranslations.quizId, quizId),
          eq(quizTranslations.locale, locale),
        ),
      );

    await tx
      .update(quizQuestionTranslations)
      .set({ status, ...reviewed })
      .where(
        and(
          eq(quizQuestionTranslations.locale, locale),
          sql`${quizQuestionTranslations.questionId} in (
            select id from ${quizQuestions} where quiz_id = ${quizId}
          )`,
        ),
      );

    await tx
      .update(quizOptionTranslations)
      .set({ status, ...reviewed })
      .where(
        and(
          eq(quizOptionTranslations.locale, locale),
          sql`${quizOptionTranslations.optionId} in (
            select o.id from ${quizOptions} o
            join ${quizQuestions} q on q.id = o.question_id
            where q.quiz_id = ${quizId}
          )`,
        ),
      );
  });
}

/** Who wrote it, recorded once — the first save owns the byline. */
export async function claimQuizTranslator(
  quizId: string,
  locale: string,
  userId: string,
): Promise<void> {
  await getDb()
    .update(quizTranslations)
    .set({ translatedBy: userId })
    .where(
      and(
        eq(quizTranslations.quizId, quizId),
        eq(quizTranslations.locale, locale),
        // Only when nobody holds it. A later editor fixing a typo does not
        // take the byline from the person who did the work — and a
        // mistranslated question should lead back to whoever wrote it.
        sql`${quizTranslations.translatedBy} is null`,
      ),
    );
}
