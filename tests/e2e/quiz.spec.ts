import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import { signUpViaApi, uniqueEmail } from "./support/accounts";

/**
 * The quiz catalogue, and what an anonymous visitor can reach.
 *
 * Journey 2 from #13 used to end here with a score, because attempts lived in
 * `sessionStorage` and anybody could take one. #26 moved them to Postgres and
 * made a sitting belong to an account, so the full journey — start, answer,
 * submit, review, resume — is `tests/e2e/exam.spec.ts`. What is left here is
 * the half that is still anonymous, plus the accessibility of a timed test.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

test.beforeAll(() => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));
});

test.afterAll(async () => {
  await close?.();
});

test.describe("taking a quiz", () => {
  test("reaches a quiz from the catalogue and sees the rules before committing", async ({
    page,
  }) => {
    await page.goto("/quiz");

    await expect(
      page.getByRole("heading", { name: /quiz/i }).first(),
    ).toBeVisible();

    // Enter the first quiz on the page rather than hard-coding a slug, so
    // reordering the catalogue does not break the test.
    await page
      .getByRole("link", { name: /start quiz/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/quiz\/[a-z0-9-]+/);

    // A timer that appears only after Start is a surprise, not a rule.
    await expect(page.getByText(/time limit/i)).toBeVisible();
    await expect(page.getByText(/pass mark/i)).toBeVisible();
    await expect(page.getByText(/attempts/i).first()).toBeVisible();

    // And the honest reason there is no Start button here.
    await expect(page.getByText(/needs an account/i)).toBeVisible();
  });

  /**
   * Known, tracked violations. The list is deliberately not empty and
   * deliberately not a `.disableRules()` call: filtering the rule out entirely
   * would also hide any NEW contrast failure. Pinning the exact ids means the
   * suite still fails the moment a different violation appears.
   *
   * color-contrast: difficulty badges, 1.64:1 and 2.06:1 — issue #33.
   */
  const KNOWN_VIOLATIONS: string[] = [];

  test("the quiz list has no accessibility violations beyond the tracked ones", async ({
    page,
  }) => {
    await page.goto("/quiz");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const unexpected = results.violations
      .filter((v) => !KNOWN_VIOLATIONS.includes(v.id))
      .map((v) => `${v.id}: ${v.help}`);

    expect(unexpected, "new axe violations").toEqual([]);
  });

  test("a sitting is operable by keyboard and free of axe violations", async ({
    page,
  }) => {
    // The screen this covers is the one where accessibility matters most and
    // is easiest to get wrong: a timed test, under time pressure, with a live
    // region and a group of options that has to behave like a radiogroup.
    await page.goto("/");
    await signUpViaApi(page, uniqueEmail("quiz-a11y"));
    await page.goto("/quiz/periodic-table-basics");
    await page.getByRole("button", { name: /start quiz/i }).click();
    await page.waitForURL(/\/quiz\/.+\/attempt/);

    await expect(page.getByRole("radiogroup")).toBeVisible();

    // Answerable without a mouse: focus the first option and choose it with
    // the keyboard, as a candidate using a screen reader would.
    await page.getByRole("radio").first().focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("radio").first()).toBeChecked();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    expect(
      results.violations.map((v) => `${v.id}: ${v.help}`),
      "axe violations on a live sitting",
    ).toEqual([]);

    // The database handle exists so the suite fails loudly when it is pointed
    // at nothing, matching the other specs.
    expect(db).toBeTruthy();
  });
});
