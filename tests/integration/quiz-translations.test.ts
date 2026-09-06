import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import {
  getQuizTranslation,
  saveQuizTranslation,
  setQuizTranslationStatus,
} from "@/db/queries/admin/quiz-translations";
import { getPaper, startAttempt } from "@/db/queries/exams/attempts";
import {
  createQuestion,
  createQuiz,
  createUser,
  translateOption,
  translateQuestion,
  translateQuiz,
} from "../factories";

/**
 * Translating a quiz, against real Postgres.
 *
 * The criterion the whole feature exists for is at the bottom of this file:
 * **an Arabic reader sitting a fully translated quiz sees no English**. Before
 * `quiz_option_translations` existed, the sitting query read
 * `quiz_options.label` directly, so a translated quiz rendered an Arabic
 * question above English answers — worse than serving the whole thing in
 * English, because the reader cannot tell whether they got it wrong or merely
 * could not read the choices.
 *
 * The rest is the mechanism that keeps that true: a per-option `source_hash`
 * so retyping one label marks that option and nothing else, and the atomic
 * group rule so a half-translated question falls back rather than mixing.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

const CANDIDATE = `xlate-candidate-${uuidv7()}`;
const ACTOR = `xlate-actor-${uuidv7()}`;

let quizId: string;
let slug: string;
let questionId: string;
let optionIds: string[];

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));
  await createUser(db, { id: CANDIDATE, name: "Candidate" });
  await createUser(db, { id: ACTOR, name: "Translator" });
});

afterAll(async () => {
  await db
    .delete(schema.quizzes)
    .where(sql`${schema.quizzes.slug} like 'xlatequiz-%'`);
  await close?.();
});

/** A published, answerable quiz with one question and two options. */
beforeEach(async () => {
  const quiz = await createQuiz(db, {
    slug: `xlatequiz-${uuidv7()}`,
    title: "Acids",
    description: "A short quiz.",
    status: "published",
  });
  quizId = quiz.id;
  slug = quiz.slug;

  const question = await createQuestion(db, quizId, {
    position: 1,
    prompt: "What is an acid?",
    explanation: "Because it donates a proton.",
    answerable: true,
  });
  questionId = question.id;

  optionIds = (
    await db
      .select({ id: schema.quizOptions.id })
      .from(schema.quizOptions)
      .where(eq(schema.quizOptions.questionId, questionId))
      .orderBy(schema.quizOptions.position)
  ).map((row) => row.id);

  await db
    .update(schema.quizzes)
    .set({ publishedAt: new Date() })
    .where(eq(schema.quizzes.id, quizId));
});

/** Publishes a full Arabic translation of everything in the quiz. */
async function translateEverything(
  status: "published" | "draft" = "published",
) {
  await translateQuiz(db, quizId, { status, title: "الأحماض" });
  await translateQuestion(db, questionId, { status });
  for (const [index, id] of optionIds.entries()) {
    await translateOption(db, id, { status, label: `خيار ${index + 1}` });
  }
}

/** The paper an Arabic reader is actually served. */
async function arabicPaper() {
  const started = await startAttempt(slug, CANDIDATE);
  if (!started.ok) throw new Error(`could not start: ${started.reason}`);
  const paper = await getPaper(started.attemptId, CANDIDATE, "ar");
  if (!paper) throw new Error("no paper");
  return paper;
}

const LATIN = /[A-Za-z]/;

describe("the option source hash", () => {
  it("is generated from the label alone", async () => {
    const [before] = await db
      .select({ hash: schema.quizOptions.sourceHash })
      .from(schema.quizOptions)
      .where(eq(schema.quizOptions.id, optionIds[0]!));

    await db
      .update(schema.quizOptions)
      .set({ label: "Something else entirely" })
      .where(eq(schema.quizOptions.id, optionIds[0]!));

    const [after] = await db
      .select({ hash: schema.quizOptions.sourceHash })
      .from(schema.quizOptions)
      .where(eq(schema.quizOptions.id, optionIds[0]!));

    expect(after?.hash).not.toBe(before?.hash);
  });

  it("does not move when only `is_correct` changes", async () => {
    // Which option is right is not a property of the language it is written
    // in. Folding it into the hash would mark a translation stale for an edit
    // no translator can act on.
    const [before] = await db
      .select({ hash: schema.quizOptions.sourceHash })
      .from(schema.quizOptions)
      .where(eq(schema.quizOptions.id, optionIds[1]!));

    await db
      .update(schema.quizOptions)
      .set({ isCorrect: true })
      .where(eq(schema.quizOptions.id, optionIds[1]!));

    const [after] = await db
      .select({ hash: schema.quizOptions.sourceHash })
      .from(schema.quizOptions)
      .where(eq(schema.quizOptions.id, optionIds[1]!));

    expect(after?.hash).toBe(before?.hash);
  });

  it("marks only the edited option stale, not its siblings or its question", async () => {
    await translateEverything();

    await db
      .update(schema.quizOptions)
      .set({ label: "Retyped" })
      .where(eq(schema.quizOptions.id, optionIds[0]!));

    const view = await getQuizTranslation(slug, "ar");
    const question = view!.questions[0]!;

    // Every translatable row hashes exactly its own fields, so one retyped
    // label is one stale row — not a whole quiz to redo.
    expect(question.options[0]!.state).toBe("stale");
    expect(question.options[1]!.state).toBe("published");
    expect(question.state).toBe("published");
  });
});

describe("what a reader is served", () => {
  it("shows no English at all once everything is translated", async () => {
    // THE criterion. Before this feature the prompt was Arabic and the answer
    // options were English, which is worse than all-English.
    await translateEverything();

    const paper = await arabicPaper();
    const question = paper.questions[0]!;

    expect(question.prompt).not.toMatch(LATIN);
    for (const option of question.options) {
      expect(option.label).not.toMatch(LATIN);
    }
  });

  it("shows the whole question in English when ONE option is untranslated", async () => {
    // Not a partial win. An Arabic question above one Arabic and one English
    // option is a question nobody can answer, so `chooseForGroup` puts the
    // whole thing back into the source language.
    await translateQuiz(db, quizId, { status: "published" });
    await translateQuestion(db, questionId, { status: "published" });
    await translateOption(db, optionIds[0]!, { status: "published" });

    const paper = await arabicPaper();
    const question = paper.questions[0]!;

    expect(question.prompt).toBe("What is an acid?");
    expect(question.options.map((o) => o.label).sort()).toEqual([
      "Right",
      "Wrong",
    ]);
  });

  it("shows the whole question in English when one option is still a draft", async () => {
    // Somebody's work in progress reaching a candidate mid-sitting is the
    // same failure whether it is the prompt or an answer.
    await translateEverything("published");
    await db
      .update(schema.quizOptionTranslations)
      .set({ status: "draft" })
      .where(eq(schema.quizOptionTranslations.optionId, optionIds[1]!));

    const paper = await arabicPaper();
    expect(paper.questions[0]!.prompt).toBe("What is an acid?");
  });

  it("shows the whole question in English when one option went stale", async () => {
    await translateEverything();
    await db
      .update(schema.quizOptions)
      .set({ label: "Edited after the translation" })
      .where(eq(schema.quizOptions.id, optionIds[0]!));

    // `assessed`: a paper has nowhere to put a caveat, and an option whose
    // English has moved on may no longer be the answer it is scored against.
    const paper = await arabicPaper();
    expect(paper.questions[0]!.prompt).toBe("What is an acid?");
  });
});

describe("saving and signing off", () => {
  it("writes the quiz, its questions and its options in one go", async () => {
    await saveQuizTranslation(quizId, "ar", {
      title: "الأحماض",
      description: "اختبار قصير",
      questions: [
        {
          id: questionId,
          prompt: "ما هو الحمض؟",
          explanation: "لأنه يمنح بروتونًا.",
          options: optionIds.map((id, index) => ({
            id,
            label: `خيار ${index + 1}`,
          })),
        },
      ],
    });

    const view = await getQuizTranslation(slug, "ar");
    expect(view?.translation?.title).toBe("الأحماض");
    expect(view?.questions[0]?.translatedPrompt).toBe("ما هو الحمض؟");
    expect(
      view?.questions[0]?.options.map((option) => option.translatedLabel),
    ).toEqual(["خيار 1", "خيار 2"]);
  });

  it("clears staleness, because a save is made from the source as it stands", async () => {
    await translateEverything();
    await db
      .update(schema.quizOptions)
      .set({ label: "Retyped" })
      .where(eq(schema.quizOptions.id, optionIds[0]!));

    const before = await getQuizTranslation(slug, "ar");
    expect(before!.questions[0]!.options[0]!.state).toBe("stale");

    await saveQuizTranslation(quizId, "ar", {
      title: "الأحماض",
      description: "اختبار قصير",
      questions: [
        {
          id: questionId,
          prompt: "ما هو الحمض؟",
          explanation: "لأن.",
          options: optionIds.map((id) => ({ id, label: "خيار" })),
        },
      ],
    });

    const after = await getQuizTranslation(slug, "ar");
    // A translator who has just re-read the English against their words has
    // done the work the flag was asking for, so "out of date" goes away.
    //
    // The STATUS is untouched — this row stays published. Saving text and
    // deciding it is ready are different acts with different permissions, and
    // that is the same rule the lesson editor follows.
    expect(after!.questions[0]!.options[0]!.state).toBe("published");
  });

  it("moves the options along with the quiz when the status changes", async () => {
    // The reason it must be one transaction is sharper than for a lesson: a
    // published question over draft options is served entirely in English by
    // `chooseForGroup`, so the translation an editor just published would be
    // invisible to every reader with no error anywhere to explain it.
    await translateEverything("draft");
    await setQuizTranslationStatus(quizId, "ar", "published", ACTOR);

    const rows = await db
      .select({ status: schema.quizOptionTranslations.status })
      .from(schema.quizOptionTranslations)
      .where(sql`${schema.quizOptionTranslations.optionId} in (
        select o.id from quiz_options o
        join quiz_questions q on q.id = o.question_id
        where q.quiz_id = ${quizId}
      )`);

    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.status).toBe("published");

    // And the reader sees the result, which is the only thing that proves the
    // transaction did what it was for.
    const paper = await arabicPaper();
    expect(paper.questions[0]!.prompt).not.toMatch(LATIN);
  });

  it("clears the sign-off when a translation is sent back to draft", async () => {
    await translateEverything();
    await setQuizTranslationStatus(quizId, "ar", "published", ACTOR);
    await setQuizTranslationStatus(quizId, "ar", "draft", null);

    const [row] = await db
      .select({
        reviewedBy: schema.quizTranslations.reviewedBy,
        reviewedAt: schema.quizTranslations.reviewedAt,
      })
      .from(schema.quizTranslations)
      .where(eq(schema.quizTranslations.quizId, quizId));

    // A row that says "reviewed by" while sitting in draft is a claim nobody
    // made.
    expect(row?.reviewedBy).toBeNull();
    expect(row?.reviewedAt).toBeNull();
  });

  it("never carries an answer key onto the translation screen", async () => {
    await translateEverything();
    const view = await getQuizTranslation(slug, "ar");

    // A translator renders the words. Which one is right is not theirs to see
    // and not theirs to move — and there is no column to put it in.
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain("isCorrect");
    expect(serialised).not.toContain("is_correct");
  });
});
