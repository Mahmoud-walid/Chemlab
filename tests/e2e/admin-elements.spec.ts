import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { signInAs } from "./support/accounts";

/**
 * The element editor, end to end.
 *
 * Proves the parts the integration suite cannot: that the form posts what the
 * operator typed, that the server action accepts it, and that a role without
 * `element:update` cannot reach the editor at all.
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

test.beforeAll(() => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));
});

test.afterAll(async () => {
  await close?.();
});

test.describe("the element admin", () => {
  test("lists, searches and sorts through the URL", async ({ page }) => {
    await signInAs(page, db, "editor");
    await page.goto("/admin/elements");

    await expect(page.getByRole("link", { name: "Hydrogen" })).toBeVisible();

    // Filtering narrows the list and lands in the URL, so the view is linkable.
    await page.getByLabel("Search").fill("Iron");
    await expect(page).toHaveURL(/q=Iron/, { timeout: 10_000 });
    await expect(page.getByRole("link", { name: "Iron" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Hydrogen" })).toHaveCount(0);

    // A copied URL reproduces the exact view.
    await page.goto("/admin/elements?q=Iron");
    await expect(page.getByRole("link", { name: "Iron" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Hydrogen" })).toHaveCount(0);
  });

  test("edits an element and persists it", async ({ page }) => {
    await signInAs(page, db, "editor");

    const [before] = await db
      .select()
      .from(schema.elements)
      .where(eq(schema.elements.number, 10));

    await page.goto("/admin/elements/10");
    // Exact: every panel is mounted now, and "Name" also matches "Named by".
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Neon");

    const summary = `Edited at ${Date.now()}.`;
    await page.getByRole("tab", { name: /editorial/i }).click();
    await page.getByLabel("Summary", { exact: true }).fill(summary);
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByText(/^Saved\.$/).first()).toBeVisible({
      timeout: 15_000,
    });

    await page.reload();
    await page.getByRole("tab", { name: /editorial/i }).click();
    await expect(page.getByLabel("Summary", { exact: true })).toHaveValue(
      summary,
    );

    // Restore, so `pnpm db:verify` still matches data/.
    await db
      .update(schema.elements)
      .set({ summary: before!.summary })
      .where(eq(schema.elements.number, 10));
  });

  test("refuses an implausible edit with a named reason", async ({ page }) => {
    await signInAs(page, db, "editor");
    // A different element from the editing test: these run in parallel, and
    // two tests driving the same row race over what it contains.
    await page.goto("/admin/elements/18");

    await page.getByRole("tab", { name: /physical/i }).click();
    await page.getByLabel("Melting point", { exact: true }).fill("500");
    await page.getByLabel("Boiling point", { exact: true }).fill("100");
    await page.getByRole("button", { name: /save changes/i }).click();

    // Well-formed but impossible: the message says which, not "invalid input".
    await expect(
      page.getByText(/boiling point is below the melting point/i),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("shows a role without element permissions nothing of the section", async ({
    page,
  }) => {
    // `moderator` holds admin:access but nothing on elements.
    await signInAs(page, db, "moderator");

    for (const path of ["/admin/elements", "/admin/elements/10"]) {
      await page.goto(path);

      // Asserted on the CONTENT, not the status. The refusal renders the
      // not-found page, but Next has already committed a 200 by the time a
      // section check can run — see the note in the admin layout and Q31.
      // What matters is that nothing of the section reaches the browser.
      await expect(
        page.getByRole("heading", { name: /not found/i }),
        path,
      ).toBeVisible();

      const html = await page.content();
      expect(html, path).not.toContain("Hydrogen");
      expect(html, path).not.toContain("diatomic nonmetal");
      expect(html, path).not.toContain('href="/admin/elements/1"');
    }
  });
});
