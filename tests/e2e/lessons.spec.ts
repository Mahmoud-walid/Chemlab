import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";

/**
 * A lesson, read.
 *
 * What only the browser can show: that the page renders from the database
 * rather than from the two hand-written routes it replaced, that the table of
 * contents actually navigates, and that a view is recorded by a reader rather
 * than by the build — the lesson page is prerendered, so an `after()` inside
 * it would have counted the build once and no reader ever.
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

async function eventually<T>(read: () => Promise<T[]>, attempts = 24) {
  for (let i = 0; i < attempts; i++) {
    const rows = await read();
    if (rows.length > 0) return rows;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return read();
}

test.describe("reading a lesson", () => {
  test("renders the seeded body, its headings and its references", async ({
    page,
  }) => {
    await page.goto("/lessons/introduction-basics");

    await expect(
      page.getByRole("heading", { level: 1, name: /introduction/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: /what is chemistry/i }),
    ).toBeVisible();
    await expect(page.getByText(/scientific study of matter/i)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /references/i }),
    ).toBeVisible();
  });

  test("shows an estimated reading time", async ({ page }) => {
    await page.goto("/lessons/introduction-basics");
    await expect(page.getByText(/min read/i)).toBeVisible();
  });

  test("renders a callout authored as a block", async ({ page }) => {
    // `studying-chemistry` was a hand-written route whose callouts lived in
    // JSX. Migrating it to blocks has to keep them.
    await page.goto("/lessons/studying-chemistry");
    await expect(
      page.getByRole("note").filter({ hasText: /connects every scientific/i }),
    ).toBeVisible();
  });

  test("the table of contents navigates to a section", async ({ page }) => {
    await page.goto("/lessons/introduction-basics");

    const toc = page.getByRole("navigation", { name: /contents/i });
    await expect(toc).toBeVisible();

    await toc.getByRole("link").nth(1).click();
    await expect(page).toHaveURL(/#section-2/);
  });

  test("offers something to read next", async ({ page }) => {
    await page.goto("/lessons/introduction-basics");
    const next = page.getByRole("heading", { name: /read next/i });
    await expect(next).toBeVisible();
  });

  test("answers 404 for a slug that is not a lesson", async ({ page }) => {
    const response = await page.goto("/lessons/not-a-lesson-at-all");
    expect(response?.status()).toBe(404);
  });

  test("records that a reader read it", async ({ page }) => {
    const before = await db
      .select({ id: schema.activityEvents.id })
      .from(schema.activityEvents)
      .where(eq(schema.activityEvents.objectId, "studying-chemistry"));

    await page.goto("/lessons/studying-chemistry");

    const rows = await eventually(async () => {
      const all = await db
        .select({ id: schema.activityEvents.id })
        .from(schema.activityEvents)
        .where(eq(schema.activityEvents.objectId, "studying-chemistry"));
      return all.length > before.length ? all : [];
    });

    expect(rows.length).toBeGreaterThan(before.length);
  });

  test("records nothing for a slug nobody published", async ({ page }) => {
    // Without the lookup this endpoint writes an activity row for any string
    // anyone posts, and "most-read lessons" becomes a list of whatever an
    // attacker typed.
    const forged = `forged-${Date.now()}`;
    const response = await page.request.post(`/api/lessons/${forged}/view`);
    expect(response.status()).toBe(204);

    const rows = await db
      .select({ id: schema.activityEvents.id })
      .from(schema.activityEvents)
      .where(eq(schema.activityEvents.objectId, forged));
    expect(rows).toHaveLength(0);
  });

  test("the two hand-written routes are gone", async ({ page }) => {
    // They rendered one lesson each as JSX and shadowed the `[slug]` route.
    const response = await page.goto(
      "/lessons/introduction-basics/studying-chemistry",
    );
    expect(response?.status()).toBe(404);
  });
});
