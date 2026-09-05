import { expect, test } from "@playwright/test";
import { asc, eq } from "drizzle-orm";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { signInAs } from "./support/accounts";

/**
 * Writing a lesson.
 *
 * What only the browser settles: that the editor loads a body without losing
 * anything, that autosave actually reaches the database, and that the preview
 * is the public renderer rather than a lookalike that can disagree with it.
 */

test.describe.configure({ timeout: 120_000, mode: "serial" });

let db: SeedDatabase;
let close: () => Promise<void>;

const SLUG = "introduction-basics";

/** The body as it was before this spec typed into it. */
let original: { heading: string; position: number; body: unknown }[] = [];

test.beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  original = (await body()).sections;
});

test.afterAll(async () => {
  // These tests edit a SEEDED lesson, and the integration suite asserts that
  // the same lesson's prose still matches `data/lessons/*.json` verbatim. On a
  // shared local database the two would collide, and the failure would look
  // like a broken migration rather than a test leaving its litter behind.
  const [lesson] = await db
    .select({ id: schema.lessons.id })
    .from(schema.lessons)
    .where(eq(schema.lessons.slug, SLUG));

  if (lesson && original.length > 0) {
    await db
      .delete(schema.lessonSections)
      .where(eq(schema.lessonSections.lessonId, lesson.id));
    await db.insert(schema.lessonSections).values(
      original.map((section) => ({
        lessonId: lesson.id,
        position: section.position,
        heading: section.heading,
        body: section.body as never,
      })),
    );
  }

  await close?.();
});

async function body() {
  const [lesson] = await db
    .select({
      id: schema.lessons.id,
      revision: schema.lessons.revision,
      readingTimeSeconds: schema.lessons.readingTimeSeconds,
    })
    .from(schema.lessons)
    .where(eq(schema.lessons.slug, SLUG));

  const sections = await db
    .select({
      heading: schema.lessonSections.heading,
      position: schema.lessonSections.position,
      body: schema.lessonSections.body,
    })
    .from(schema.lessonSections)
    .where(eq(schema.lessonSections.lessonId, lesson!.id))
    // Ordered, or this reads back Postgres' PHYSICAL row order — which
    // changes the moment a save updates one section and moves its row. The
    // id test then compares two differently ordered lists and fails, having
    // asserted the storage layout rather than the ids it means to check.
    .orderBy(asc(schema.lessonSections.position));

  return { lesson: lesson!, sections };
}

test.describe("the lesson editor", () => {
  test("loads the seeded body without losing a section", async ({ page }) => {
    await signInAs(page, db, "editor");
    await page.goto(`/admin/lessons/${SLUG}/edit`);

    const before = await body();
    const headings = page.getByLabel(/^section \d/i);
    await expect(headings.first()).toBeVisible();
    expect(await headings.count()).toBe(before.sections.length);
  });

  test("previews through the public renderer", async ({ page }) => {
    await signInAs(page, db, "editor");
    await page.goto(`/admin/lessons/${SLUG}/edit`);

    const preview = page.getByText(/scientific study of matter/i).last();
    await expect(preview).toBeVisible();
  });

  test("autosaves an edit, bumping the revision and the reading time", async ({
    page,
  }) => {
    await signInAs(page, db, "editor");
    const before = await body();

    await page.goto(`/admin/lessons/${SLUG}/edit`);
    await expect(page.getByLabel(/^body of section 1/i)).toBeVisible();

    await page.getByLabel(/^body of section 1/i).click();
    await page.keyboard.type(" A sentence added by the editor test.");

    await expect(page.getByText(/^saved\.$/i)).toBeVisible({ timeout: 15_000 });

    const after = await body();
    expect(after.lesson.revision).toBeGreaterThan(before.lesson.revision);
    expect(after.lesson.readingTimeSeconds).toBeGreaterThanOrEqual(
      before.lesson.readingTimeSeconds,
    );

    const text = JSON.stringify(after.sections);
    expect(text).toContain("A sentence added by the editor test.");
  });

  test("the edit survives a reload, which is what saved means", async ({
    page,
  }) => {
    await signInAs(page, db, "editor");
    await page.goto(`/admin/lessons/${SLUG}/edit`);
    await expect(
      page.getByText(/A sentence added by the editor test\./).first(),
    ).toBeVisible();
  });

  test("keeps every block id across a save", async ({ page }) => {
    // The ids are what a translation attaches to. A save that re-keys them
    // orphans every translation made from the old body.
    const before = await body();
    const idsBefore = before.sections.flatMap((section) =>
      section.body.map((block) => block.id),
    );

    await signInAs(page, db, "editor");
    await page.goto(`/admin/lessons/${SLUG}/edit`);
    await page.getByLabel(/^body of section 1/i).click();
    await page.keyboard.type(" More.");
    await expect(page.getByText(/^saved\.$/i)).toBeVisible({ timeout: 15_000 });

    const after = await body();
    const idsAfter = after.sections.flatMap((section) =>
      section.body.map((block) => block.id),
    );
    expect(idsAfter).toEqual(idsBefore);
  });

  test("shows a role without lesson:update nothing of the editor", async ({
    page,
  }) => {
    // `moderator` reaches /admin but has no business rewriting a lesson.
    await signInAs(page, db, "moderator");
    const response = await page.goto(`/admin/lessons/${SLUG}/edit`);
    expect(response?.status()).toBe(404);
  });

  test("the lesson page links to the editor", async ({ page }) => {
    await signInAs(page, db, "editor");
    await page.goto(`/admin/lessons/${SLUG}`);
    await expect(
      page.getByRole("link", { name: /write the lesson/i }),
    ).toBeVisible();
  });
});
