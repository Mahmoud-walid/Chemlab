import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { signInAs, signUpViaApi, uniqueEmail } from "./support/accounts";

/**
 * Sitting a quiz, end to end.
 *
 * The claim these exist for is the one the old implementation got wrong: the
 * candidate's browser must never hold the answer key. `data/quiz.json` used to
 * be imported into a `"use client"` component, so every answer and explanation
 * for all six quizzes shipped in the bundle before a single question was
 * answered.
 */

test.describe.configure({ timeout: 120_000, mode: "serial" });

let db: SeedDatabase;
let close: () => Promise<void>;

const SLUG = "periodic-table-basics";
/** Seeded content, used to prove where it does and does not appear. */
const EXPLANATION = "Gold's symbol Au comes from its Latin name Aurum";

test.beforeAll(() => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));
});

test.afterAll(async () => {
  await close?.();
});

/** A fresh account per test, so attempt caps and history never bleed across. */
async function freshCandidate(page: Page): Promise<string> {
  await page.goto("/");
  const email = uniqueEmail("exam");
  await signUpViaApi(page, email);
  return email;
}

test.describe("taking a quiz", () => {
  test("asks an anonymous visitor to sign in, without hiding the quiz", async ({
    page,
  }) => {
    // Redirecting instead would lose the page they were reading, and the
    // rules of the sitting are worth showing before anybody commits to them.
    await page.goto(`/quiz/${SLUG}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/needs an account/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /start quiz/i })).toHaveCount(
      0,
    );
  });

  test("never sends the answer key to the browser", async ({ page }) => {
    await freshCandidate(page);
    await page.goto(`/quiz/${SLUG}`);
    await page.getByRole("button", { name: /start quiz/i }).click();
    await page.waitForURL(/\/quiz\/.+\/attempt/);

    // The whole served document, script payload included — not just what is
    // rendered. Next serialises server-component props into the page, so an
    // over-wide query would show up right here.
    const html = await page.content();
    expect(html.includes(EXPLANATION), "an explanation reached the page").toBe(
      false,
    );
    expect(
      html.includes("isCorrect"),
      "a correctness flag reached the page",
    ).toBe(false);
  });

  test("answers, submits, and shows the mark with the explanations", async ({
    page,
  }) => {
    await freshCandidate(page);
    await page.goto(`/quiz/${SLUG}`);
    await page.getByRole("button", { name: /start quiz/i }).click();
    await page.waitForURL(/\/quiz\/.+\/attempt/);

    // Ten questions; answer the first option of each and submit.
    for (let i = 0; i < 10; i++) {
      await page.getByTestId("quiz-option").first().click();
      const next = page.getByRole("button", { name: /^next question$/i });
      if (await next.isVisible()) await next.click();
    }

    await page.getByRole("button", { name: /submit answers/i }).click();
    await page.waitForURL(/\/attempts\//);

    // The score comes from the server, and the explanations appear only now.
    await expect(page.getByText(/^Result$/)).toBeVisible();
    await expect(page.getByText(EXPLANATION)).toBeVisible();
  });

  test("resumes the same paper after a reload, answers intact", async ({
    page,
  }) => {
    await freshCandidate(page);
    await page.goto(`/quiz/${SLUG}`);
    await page.getByRole("button", { name: /start quiz/i }).click();
    await page.waitForURL(/\/quiz\/.+\/attempt/);

    const firstPrompt = await page
      .locator("p.font-semibold")
      .first()
      .textContent();
    const options = await page.getByTestId("quiz-option").allTextContents();
    // The save is a server action, and the radio being checked is OPTIMISTIC
    // client state — it says the click was received, not that the answer was
    // stored. Reloading on that signal races the round trip, and under the
    // load of the full suite the reload won: the paper came back with nothing
    // selected. Waiting for the response is waiting for the actual save.
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && response.status() < 400,
    );
    await page.getByTestId("quiz-option").first().click();
    await expect(page.locator("input[type=radio]").first()).toBeChecked();
    await saved;

    await page.reload();

    // Same seed, same paper — the order is derived from a stored integer, not
    // reshuffled on mount as the old runner did.
    expect(await page.locator("p.font-semibold").first().textContent()).toBe(
      firstPrompt,
    );
    expect(await page.getByTestId("quiz-option").allTextContents()).toEqual(
      options,
    );
    await expect(page.locator("input[type=radio]").first()).toBeChecked();
  });

  test("keeps the sitting open in the candidate's history", async ({
    page,
  }) => {
    await freshCandidate(page);
    await page.goto(`/quiz/${SLUG}`);
    await page.getByRole("button", { name: /start quiz/i }).click();
    await page.waitForURL(/\/quiz\/.+\/attempt/);

    await page.goto(`/quiz/${SLUG}`);
    // Resuming, not starting a second sitting: the one-live-attempt index
    // would refuse a second, and telling the candidate they have an attempt
    // open with no way to reach it is the unhelpful version.
    await expect(page.getByRole("button", { name: /resume/i })).toBeVisible();
  });

  test("records the sitting against the account", async ({ page }) => {
    const email = await freshCandidate(page);
    await page.goto(`/quiz/${SLUG}`);
    await page.getByRole("button", { name: /start quiz/i }).click();
    await page.waitForURL(/\/quiz\/.+\/attempt/);

    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email));
    const rows = await db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.userId, user!.id));

    expect(rows).toHaveLength(1);
    // The seed is a real integer and the revision is stamped, so the paper is
    // reproducible and frozen against edits made mid-sitting.
    expect(Number.isInteger(rows[0]!.seed)).toBe(true);
    expect(rows[0]!.quizRevision).toBeInstanceOf(Date);
  });

  test("redirects the old session-only results page to the account history", async ({
    page,
  }) => {
    await signInAs(page, db, "member");
    const response = await page.goto("/quiz/results");
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe("/profile/exams");
  });
});
