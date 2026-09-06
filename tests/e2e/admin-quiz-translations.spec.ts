import { expect, test } from "@playwright/test";
import { eq, like } from "drizzle-orm";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { createQuestion, createQuiz } from "../factories";
import { signInAs } from "./support/accounts";

/**
 * Translating a quiz, end to end.
 *
 * What only a browser can prove: that the answer OPTIONS get boxes of their
 * own, that a question left half-translated cannot be submitted, and that a
 * candidate sitting the published translation is asked a question entirely in
 * their own language — the failure this whole feature exists for is a quiz
 * that renders an Arabic question above English answers.
 */

/**
 * The admin routes are visited with an explicit `/en` prefix.
 *
 * next-intl remembers the last locale in a cookie, so a test that looks at an
 * Arabic reader page and then opens the admin gets the admin in Arabic — where
 * every button name in this file would miss, and `toHaveCount(0)` is true of a
 * button whose label is in another language.
 */

/** Sign-up hashes deliberately slowly; several workers need the headroom. */
test.describe.configure({ timeout: 120_000 });

let db: SeedDatabase;
let close: () => Promise<void>;

/** Per WORKER: `afterAll` runs once per worker, not once per file. */
const PREFIX = `e2e-qxlate-w${process.env.TEST_WORKER_INDEX ?? "0"}-`;

test.beforeAll(() => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));
});

test.afterAll(async () => {
  await db
    .delete(schema.quizzes)
    .where(like(schema.quizzes.slug, `${PREFIX}%`));
  await close?.();
});

async function quizToTranslate(): Promise<string> {
  const quiz = await createQuiz(db, {
    slug: `${PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: "Acids and bases",
    description: "A first look at acids.",
    status: "published",
  });

  // The default-locale mirror row, which the app's own create action writes
  // and which every reader query joins against. The hash comes from the
  // generated column via the factory, never recomputed here.
  await db.insert(schema.quizTranslations).values({
    quizId: quiz.id,
    locale: "en",
    title: "Acids and bases",
    description: "A first look at acids.",
    status: "published",
    sourceHash: quiz.sourceHash,
  });

  await createQuestion(db, quiz.id, {
    position: 1,
    prompt: "What is an acid?",
    explanation: "Because it donates a proton.",
    answerable: true,
  });

  await db
    .update(schema.quizzes)
    .set({ publishedAt: new Date() })
    .where(eq(schema.quizzes.id, quiz.id));

  return quiz.slug;
}

/**
 * The boxes, in the order the form renders them: title, description, then per
 * question the prompt, the explanation, and one per option.
 */
const BOX = {
  title: 0,
  description: 1,
  prompt: 2,
  explanation: 3,
  optionOne: 4,
  optionTwo: 5,
} as const;

async function fillEverything(page: import("@playwright/test").Page) {
  const boxes = page.getByRole("textbox");
  await boxes.nth(BOX.title).fill("الأحماض والقواعد");
  await boxes.nth(BOX.description).fill("نظرة أولى.");
  await boxes.nth(BOX.prompt).fill("ما الحمض؟");
  await boxes.nth(BOX.explanation).fill("لأنه يمنح بروتونًا.");
  await boxes.nth(BOX.optionOne).fill("مانح للبروتون");
  await boxes.nth(BOX.optionTwo).fill("مستقبل للبروتون");
}

test.describe("translating a quiz", () => {
  test("gives every answer option a box of its own", async ({ page }) => {
    await signInAs(page, db, "editor");
    const slug = await quizToTranslate();
    await page.goto(`/en/admin/quizzes/${slug}/translate`);

    // The English is on screen beside every box, including the answers: a
    // translator working from a screen without the source is translating from
    // memory, and an option label out of context is a guess.
    await expect(page.getByText("What is an acid?").first()).toBeVisible();
    await expect(
      page.getByText("Right", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Wrong", { exact: true }).first(),
    ).toBeVisible();

    // Two for the quiz, two for the question, one per option.
    await expect(page.getByRole("textbox")).toHaveCount(6);
  });

  test("lets an editor write and submit, but not publish", async ({ page }) => {
    await signInAs(page, db, "editor");
    const slug = await quizToTranslate();
    await page.goto(`/en/admin/quizzes/${slug}/translate`);

    await expect(
      page.getByRole("button", { name: /save translation/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /submit for review/i }),
    ).toBeVisible();

    // `editor` holds translation:write and not translation:review. The buttons
    // are absent rather than shown and refused — self-approval is how an
    // unchecked chemistry translation reaches a reader.
    await expect(
      page.getByRole("button", { name: /publish translation/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /send back to draft/i }),
    ).toHaveCount(0);
  });

  test("refuses to submit a question whose options are only half translated", async ({
    page,
  }) => {
    await signInAs(page, db, "admin");
    const slug = await quizToTranslate();
    await page.goto(`/en/admin/quizzes/${slug}/translate`);

    const boxes = page.getByRole("textbox");
    await boxes.nth(BOX.title).fill("الأحماض والقواعد");
    await boxes.nth(BOX.description).fill("نظرة أولى.");
    await boxes.nth(BOX.prompt).fill("ما الحمض؟");
    await boxes.nth(BOX.explanation).fill("لأنه يمنح بروتونًا.");
    // One option translated, the other left alone. This is exactly the state
    // that renders as a question nobody can answer.
    await boxes.nth(BOX.optionOne).fill("مانح للبروتون");

    await expect(
      page.getByText("Some questions are not finished"),
    ).toBeVisible();
    await expect(page.getByText(/one or more answer options/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /submit for review/i }),
    ).toBeDisabled();

    // And it becomes submittable the moment the last box is filled — the
    // check is about completeness, not about having typed something anywhere.
    await boxes.nth(BOX.optionTwo).fill("مستقبل للبروتون");
    await expect(page.getByText("Some questions are not finished")).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: /submit for review/i }),
    ).toBeEnabled();
  });

  test("a published translation asks the candidate in Arabic, answers included", async ({
    page,
  }) => {
    // The criterion the feature exists for. Before `quiz_option_translations`
    // the sitting read `quiz_options.label` directly, so this page showed an
    // Arabic question above English answers — worse than all-English, because
    // the reader cannot tell whether they got it wrong or could not read it.
    await signInAs(page, db, "admin");
    const slug = await quizToTranslate();

    await page.goto(`/en/admin/quizzes/${slug}/translate`);
    await fillEverything(page);
    await page
      .getByRole("button", { name: /save translation/i })
      .first()
      .click();
    await expect(page.getByText(/^Saved$/).first()).toBeVisible({
      timeout: 15_000,
    });

    // Waits for the STATE, not the toast: saving and publishing raise the same
    // "Saved" toast, so an assertion on it after publishing can be satisfied
    // by the one the save left on screen.
    await page.getByRole("button", { name: /publish translation/i }).click();
    await expect(page.getByText("Translated", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    await page.goto(`/ar/quiz/${slug}`);
    await expect(
      page.getByRole("heading", { name: "الأحماض والقواعد" }),
    ).toBeVisible();
  });
});
