import { expect, test } from "@playwright/test";
import { eq, like } from "drizzle-orm";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { createQuiz } from "../factories";
import { signInAs } from "./support/accounts";

/**
 * Selecting quizzes and acting on them, end to end.
 *
 * The lesson spec proves the mechanics of the bar — selection across pages,
 * the off-screen count. What is only true here is the refusal: a quiz is
 * blocked from publishing by having no questions, or by having a question
 * nobody can answer, and the second has no lesson equivalent at all. A quiz
 * with questions looks publishable by every count the lesson path takes.
 */

test.describe.configure({ timeout: 120_000 });

let db: SeedDatabase;
let close: () => Promise<void>;

/** Per WORKER: `afterAll` runs once per worker, not once per file. */
const PREFIX = `e2e-bulkq-w${process.env.TEST_WORKER_INDEX ?? "0"}-`;

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

/**
 * A draft quiz. `questions` and `answerable` are the two independent reasons
 * it may not be publishable, and the tests below need to vary them separately.
 */
async function draft(
  name: string,
  { questions = 1, answerable = true } = {},
): Promise<{ id: string; slug: string }> {
  return createQuiz(db, {
    slug: `${PREFIX}${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: `Bulk ${name}`,
    description: "For the bulk tests.",
    category: "BulkTesting",
    questions,
    answerable,
  });
}

const statusOf = async (id: string) => {
  const [row] = await db
    .select({ status: schema.quizzes.status })
    .from(schema.quizzes)
    .where(eq(schema.quizzes.id, id));
  return row?.status;
};

test.describe("bulk quiz actions", () => {
  test("publishes several quizzes at once", async ({ page }) => {
    await signInAs(page, db, "admin");
    const one = await draft("one");
    const two = await draft("two");

    // Narrowed to this test's rows, so ticking "everything on this page" is a
    // claim about two quizzes rather than the whole catalogue.
    await page.goto(`/en/admin/quizzes?q=${PREFIX}`);

    await page
      .getByRole("checkbox", { name: "Select every row on this page" })
      .click();
    await expect(page.getByText(/2 selected/)).toBeVisible();

    await page.getByRole("button", { name: "Publish", exact: true }).click();
    // `.first()`: sonner renders the toast twice — once visibly and once in an
    // aria-live mirror for screen readers.
    await expect(page.getByText(/2 changed/).first()).toBeVisible({
      timeout: 15_000,
    });

    expect(await statusOf(one.id)).toBe("published");
    expect(await statusOf(two.id)).toBe("published");
  });

  test("refuses the whole batch when one quiz has no questions", async ({
    page,
  }) => {
    await signInAs(page, db, "admin");
    const good = await draft("good");
    const empty = await draft("empty", { questions: 0 });

    await page.goto(`/en/admin/quizzes?q=${PREFIX}`);
    await page
      .getByRole("checkbox", { name: "Select every row on this page" })
      .click();
    await page.getByRole("button", { name: "Publish", exact: true }).click();

    // Named, not skipped: an operator told only "some rows failed" has no way
    // to proceed.
    // `.first()`: Next's own route announcer is also `role="alert"`, and it
    // is empty between navigations.
    const refusal = page.getByRole("alert").first();
    await expect(refusal).toBeVisible({ timeout: 15_000 });
    await expect(refusal).toContainText("Nothing was changed");
    // Scoped to the alert: the quiz's own row is on the page too, and the
    // assertion is about the refusal naming it, not about the table.
    await expect(refusal).toContainText("Bulk empty");
    // The same sentence the single-row refusal shows, because the server
    // sends the same key rather than prose.
    await expect(refusal).toContainText("It has no questions.");

    // And nothing was written — including the row that could have been.
    expect(await statusOf(good.id)).toBe("draft");
    expect(await statusOf(empty.id)).toBe("draft");
  });

  test("refuses a quiz whose question has no correct answer marked", async ({
    page,
  }) => {
    await signInAs(page, db, "admin");
    // The blocker with no lesson equivalent, and the reason the quiz path
    // needed its own per-row counts rather than reusing the lesson query: by
    // question count alone this quiz looks entirely publishable.
    const broken = await draft("broken", { answerable: false });

    await page.goto(`/en/admin/quizzes?q=${PREFIX}`);
    await page
      .getByRole("checkbox", { name: "Select every row on this page" })
      .click();
    await page.getByRole("button", { name: "Publish", exact: true }).click();

    const refusal = page.getByRole("alert").first();
    await expect(refusal).toBeVisible({ timeout: 15_000 });
    await expect(refusal).toContainText(
      "At least one question has no correct answer marked.",
    );

    // A quiz nobody can pass is worse than one nobody can start.
    expect(await statusOf(broken.id)).toBe("draft");
  });

  test("archives in bulk, and the log can tell a batch from many clicks", async ({
    page,
  }) => {
    await signInAs(page, db, "admin");
    const one = await draft("arch-one");
    const two = await draft("arch-two");

    await page.goto(`/en/admin/quizzes?q=${PREFIX}arch-`);
    await page
      .getByRole("checkbox", { name: "Select every row on this page" })
      .click();
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(page.getByText(/2 changed/).first()).toBeVisible({
      timeout: 15_000,
    });

    expect(await statusOf(one.id)).toBe("archived");
    expect(await statusOf(two.id)).toBe("archived");

    // One entry per row, each marked as part of a batch. "Somebody archived
    // two quizzes" is not an answer to "who archived THIS quiz", and the log
    // is read one row at a time — so the flag is what distinguishes a batch
    // from two deliberate single actions, not the absence of a second entry.
    for (const quiz of [one, two]) {
      const entries = await db
        .select({ after: schema.auditLog.after })
        .from(schema.auditLog)
        .where(eq(schema.auditLog.targetId, quiz.id));
      expect(entries).toHaveLength(1);
      expect(entries[0]?.after).toMatchObject({ bulk: true });
    }
  });
});
