import { expect, test } from "@playwright/test";
import { like } from "drizzle-orm";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { signInAs } from "./support/accounts";

/**
 * The quiz admin, end to end.
 *
 * Proves what the integration suite cannot: that the question editor's state
 * reaches the server intact, that publication is refused for the right reason,
 * and that a role without quiz permissions sees nothing of the section.
 */

/**
 * Every test here signs up a real account, and the password hash is
 * deliberately slow — that is the point of it. With several workers on a small
 * runner the default 30s test budget is not enough, and shortening the hash to
 * suit the tests would weaken the thing being tested.
 */
test.describe.configure({ timeout: 90_000 });

let db: SeedDatabase;
let close: () => Promise<void>;

const PREFIX = "e2e-quiz-";

const uniqueSlug = () =>
  `${PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test.beforeAll(() => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));
});

test.afterAll(async () => {
  // Leaving these behind would make `pnpm db:verify` report six expected
  // quizzes and find more.
  await db
    .delete(schema.quizzes)
    .where(like(schema.quizzes.slug, `${PREFIX}%`));
  await close?.();
});

async function createQuiz(
  page: import("@playwright/test").Page,
  slug: string,
  title: string,
) {
  await page.goto("/admin/quizzes/new");
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByLabel("Slug", { exact: true }).fill(slug);
  await page
    .getByLabel("Description", { exact: true })
    .fill("Created by the e2e suite.");
  await page.getByLabel("Category", { exact: true }).fill("Testing");
  await page.getByRole("button", { name: /create quiz/i }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/quizzes/${slug}$`), {
    timeout: 15_000,
  });
}

test.describe("the quiz admin", () => {
  test("lists, searches and filters by status through the URL", async ({
    page,
  }) => {
    await signInAs(page, db, "editor");
    await page.goto("/admin/quizzes");

    await expect(
      page.getByRole("link", { name: /acids/i }).first(),
    ).toBeVisible();

    await page.getByRole("link", { name: "Draft", exact: true }).click();
    await expect(page).toHaveURL(/status=draft/);
    // Every seeded quiz is published, so the draft view is empty rather than
    // showing the same rows under a different heading.
    await expect(page.getByRole("link", { name: /acids/i })).toHaveCount(0);
  });

  test("creates a draft that the public catalogue does not show", async ({
    page,
  }) => {
    await signInAs(page, db, "editor");
    const slug = uniqueSlug();
    const title = "A quiz from the e2e suite";

    await createQuiz(page, slug, title);
    await expect(page.getByText(/this quiz is draft/i)).toBeVisible();

    await page.goto("/quiz");
    await expect(page.getByText(title)).toHaveCount(0);
  });

  test("refuses to publish a quiz with no questions, naming the reason", async ({
    page,
  }) => {
    await signInAs(page, db, "editor");
    await createQuiz(page, uniqueSlug(), "Nothing asked yet");

    // Said up front rather than after a click that is then refused.
    await expect(page.getByText(/it has no questions/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^publish$/i }),
    ).toBeDisabled();
  });

  test("adds a question, saves it, and reads it back after a reload", async ({
    page,
  }) => {
    await signInAs(page, db, "editor");
    await createQuiz(page, uniqueSlug(), "Answerable");

    await page.getByRole("button", { name: /add question/i }).click();
    await page.getByLabel("Question", { exact: true }).fill("What is 2 + 2?");
    await page.getByLabel("Option 1", { exact: true }).fill("4");
    await page.getByLabel("Option 2", { exact: true }).fill("5");
    await page
      .getByLabel("Explanation", { exact: true })
      .fill("Two and two make four.");
    await page
      .getByRole("radio", { name: /option 1 is the correct answer/i })
      .check();

    await page.getByRole("button", { name: /save questions/i }).click();
    await expect(page.getByText(/questions saved/i).first()).toBeVisible({
      timeout: 15_000,
    });

    await page.reload();
    await expect(page.getByLabel("Question", { exact: true })).toHaveValue(
      "What is 2 + 2?",
    );
    await expect(page.getByLabel("Option 1", { exact: true })).toHaveValue("4");
    await expect(
      page.getByRole("radio", { name: /option 1 is the correct answer/i }),
    ).toBeChecked();

    // With a question that has an answer, publishing is now offered.
    await expect(page.getByText(/it has no questions/i)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^publish$/i }),
    ).toBeEnabled();
  });

  test("refuses a question whose options repeat", async ({ page }) => {
    await signInAs(page, db, "editor");
    await createQuiz(page, uniqueSlug(), "Ambiguous");

    await page.getByRole("button", { name: /add question/i }).click();
    await page.getByLabel("Question", { exact: true }).fill("Pick one");
    await page.getByLabel("Option 1", { exact: true }).fill("Same");
    await page.getByLabel("Option 2", { exact: true }).fill("same");
    await page.getByLabel("Explanation", { exact: true }).fill("Either.");
    await page.getByRole("button", { name: /save questions/i }).click();

    await expect(page.getByText(/two options are the same/i)).toBeVisible({
      timeout: 15_000,
    });
  });

  test("reports a slug that is already taken instead of failing silently", async ({
    page,
  }) => {
    await signInAs(page, db, "editor");
    await page.goto("/admin/quizzes/new");
    await page.getByLabel("Title", { exact: true }).fill("A clashing slug");
    await page.getByLabel("Slug", { exact: true }).fill("acids-and-bases");
    await page.getByLabel("Description", { exact: true }).fill("Clash.");
    await page.getByLabel("Category", { exact: true }).fill("Testing");
    await page.getByRole("button", { name: /create quiz/i }).click();

    await expect(page.getByText(/slug is already in use/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveURL(/\/admin\/quizzes\/new/);
  });

  test("offers withdrawal only to a role that holds quiz:delete", async ({
    page,
  }) => {
    // `editor` publishes but does not delete; `admin` does both.
    await signInAs(page, db, "editor");
    await createQuiz(page, uniqueSlug(), "Withdrawable");
    await expect(
      page.getByRole("button", { name: /withdraw quiz/i }),
    ).toHaveCount(0);
  });

  test("shows a role without quiz permissions nothing of the section", async ({
    page,
  }) => {
    // `moderator` holds admin:access but nothing on quizzes.
    await signInAs(page, db, "moderator");

    for (const path of [
      "/admin/quizzes",
      "/admin/quizzes/new",
      "/admin/quizzes/acids-and-bases",
    ]) {
      await page.goto(path);

      // Asserted on the CONTENT, not the status. The refusal renders the
      // not-found page, but Next has already committed a 200 by the time a
      // section check can run — see the note in the admin layout and Q31.
      await expect(
        page.getByRole("heading", { name: /not found/i }),
        path,
      ).toBeVisible();

      const html = await page.content();
      expect(html, path).not.toContain('href="/admin/quizzes/acids-and-bases"');
    }
  });
});
