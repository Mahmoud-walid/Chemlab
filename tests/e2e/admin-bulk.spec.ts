import { expect, test } from "@playwright/test";
import { eq, like } from "drizzle-orm";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { signInAs } from "./support/accounts";

/**
 * Selecting rows and acting on them, end to end.
 *
 * What only a browser can prove: that the selection survives paging, that the
 * bar says how many rows are off-screen, and that a refusal leaves the
 * database exactly as it was — the all-or-nothing rule is invisible from any
 * single layer.
 */

test.describe.configure({ timeout: 120_000 });

let db: SeedDatabase;
let close: () => Promise<void>;

/** Per WORKER: `afterAll` runs once per worker, not once per file. */
const PREFIX = `e2e-bulk-w${process.env.TEST_WORKER_INDEX ?? "0"}-`;

test.beforeAll(() => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));
});

test.afterAll(async () => {
  await db
    .delete(schema.lessons)
    .where(like(schema.lessons.slug, `${PREFIX}%`));
  await close?.();
});

/** A draft lesson, optionally with a section so it can be published. */
async function draft(name: string, withSection: boolean) {
  const slug = `${PREFIX}${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [lesson] = await db
    .insert(schema.lessons)
    .values({
      slug,
      title: `Bulk ${name}`,
      description: "For the bulk tests.",
      difficulty: "easy",
      category: "BulkTesting",
      status: "draft",
    })
    .returning({ id: schema.lessons.id });

  if (withSection) {
    await db.insert(schema.lessonSections).values({
      lessonId: lesson!.id,
      position: 1,
      heading: "A heading",
      body: [{ id: "p1", type: "paragraph", text: [{ text: "Words." }] }],
    });
  }
  return { id: lesson!.id, slug };
}

const statusOf = async (id: string) => {
  const [row] = await db
    .select({ status: schema.lessons.status })
    .from(schema.lessons)
    .where(eq(schema.lessons.id, id));
  return row?.status;
};

test.describe("bulk actions", () => {
  test("publishes several lessons at once", async ({ page }) => {
    await signInAs(page, db, "admin");
    const one = await draft("one", true);
    const two = await draft("two", true);

    // Narrowed to this test's rows, so ticking "everything on this page" is a
    // claim about two lessons rather than the whole catalogue.
    await page.goto(`/en/admin/lessons?q=${PREFIX}`);

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

  test("refuses the whole batch when one row cannot take the action", async ({
    page,
  }) => {
    await signInAs(page, db, "admin");
    const good = await draft("good", true);
    // No sections, so it cannot be published — the same blocker the
    // single-row path applies.
    const empty = await draft("empty", false);

    await page.goto(`/en/admin/lessons?q=${PREFIX}`);
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
    // Scoped to the alert: the lesson's own row is on the page too, and the
    // assertion is about the refusal naming it, not about the table.
    await expect(refusal).toContainText("Bulk empty");

    // And nothing was written — including the row that could have been.
    expect(await statusOf(good.id)).toBe("draft");
    expect(await statusOf(empty.id)).toBe("draft");
  });

  test("keeps a selection across pages and says how much is off-screen", async ({
    page,
  }) => {
    await signInAs(page, db, "admin");
    // Twelve rows against the smallest allowed page size, so they split.
    // `pageSize` is validated against an allow-list — 20 is not on it, and
    // an unrecognised value silently falls back to 25, which would have put
    // every row on one page and left "Next" disabled.
    for (let index = 0; index < 12; index++) {
      await draft(`page${index}`, true);
    }

    await page.goto(`/en/admin/lessons?q=${PREFIX}&pageSize=10`);
    await page
      .getByRole("checkbox", { name: "Select every row on this page" })
      .click();
    const selectedFirst = await page
      .getByRole("checkbox", { name: "Select this row" })
      .count();
    await expect(
      page.getByText(new RegExp(`${selectedFirst} selected`)),
    ).toBeVisible();

    await page.getByRole("link", { name: "Next" }).click();

    // The count survives the navigation, and the bar says what is no longer
    // in front of the operator — "21 selected" over a page showing one tick
    // reads as a bug without it.
    await expect(page.getByText(/selected/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/not on this page/)).toBeVisible();
  });
});
