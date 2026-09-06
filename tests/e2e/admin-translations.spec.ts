import { expect, test } from "@playwright/test";
import { like } from "drizzle-orm";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { signInAs } from "./support/accounts";

/**
 * Translating a lesson, end to end.
 *
 * What only a browser can prove: that the two permissions really split the
 * screen — an editor sees Save and Submit and no Publish — and that a
 * published translation reaches the public page in the reader's language.
 */

/**
 * The admin routes are visited with an explicit `/en` prefix.
 *
 * next-intl remembers the last locale in a cookie, so a test that looks at the
 * Arabic reader page and then opens the admin gets the admin in Arabic — where
 * every button name in this file would miss. The first version of this suite
 * "passed" its permission assertion for exactly that reason: `toHaveCount(0)`
 * is true of a button whose label is in another language.
 */

/** Sign-up hashes deliberately slowly; several workers need the headroom. */
test.describe.configure({ timeout: 120_000 });

let db: SeedDatabase;
let close: () => Promise<void>;

/**
 * Per WORKER, because `afterAll` deletes every row matching this prefix and
 * Playwright runs one `afterAll` per worker rather than per file. A shared
 * prefix means the worker that finishes first deletes rows another is still
 * using.
 */
const PREFIX = `e2e-xlate-w${process.env.TEST_WORKER_INDEX ?? "0"}-`;

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

async function lessonToTranslate(): Promise<string> {
  const slug = `${PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const [lesson] = await db
    .insert(schema.lessons)
    .values({
      slug,
      title: "Acids and bases",
      description: "A first look at acids.",
      difficulty: "easy",
      category: "Testing",
      status: "published",
    })
    .returning({
      id: schema.lessons.id,
      sourceHash: schema.lessons.sourceHash,
    });

  await db.insert(schema.lessonTranslations).values({
    lessonId: lesson!.id,
    locale: "en",
    title: "Acids and bases",
    description: "A first look at acids.",
    status: "published",
    sourceHash: lesson!.sourceHash,
  });

  await db.insert(schema.lessonSections).values({
    lessonId: lesson!.id,
    position: 1,
    heading: "What is an acid?",
    body: [
      { id: "p1", type: "paragraph", text: [{ text: "A proton donor." }] },
    ],
  });

  return slug;
}

/**
 * Publishes the translation and waits for the STATE, not the toast.
 *
 * Saving and publishing raise the same "Saved" toast, so an assertion on it
 * after publishing can be satisfied by the toast the save left on screen —
 * and under the load of the full suite it was: the test read the reader page
 * before the publish had landed, and saw English. The badge is a fact about
 * the row rather than a transient.
 */
async function publish(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /publish translation/i }).click();
  await expect(page.getByText("Translated", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("translating a lesson", () => {
  test("lets an editor write and submit, but not publish", async ({ page }) => {
    await signInAs(page, db, "editor");
    const slug = await lessonToTranslate();
    await page.goto(`/en/admin/lessons/${slug}/translate`);

    // The English is on screen beside every box: a translator working from a
    // screen without the source is translating from memory.
    await expect(
      page.getByText("A first look at acids.").first(),
    ).toBeVisible();
    await expect(page.getByText("A proton donor.").first()).toBeVisible();

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

  test("writes a translation that stays a draft until somebody publishes it", async ({
    page,
  }) => {
    // `admin` holds both grants, so one account can carry the whole flow.
    await signInAs(page, db, "admin");
    const slug = await lessonToTranslate();
    await page.goto(`/en/admin/lessons/${slug}/translate`);

    const boxes = page.getByRole("textbox");
    await boxes.nth(0).fill("الأحماض والقواعد");
    await boxes.nth(1).fill("نظرة أولى.");
    await boxes.nth(2).fill("ما الحمض؟");
    await boxes.nth(3).fill("مانح بروتون.");

    await page
      .getByRole("button", { name: /save translation/i })
      .first()
      .click();
    await expect(page.getByText(/^Saved$/).first()).toBeVisible({
      timeout: 15_000,
    });

    // Saved is not published: an Arabic reader still gets English.
    await page.goto(`/ar/lessons/${slug}`);
    await expect(page.getByText("الأحماض والقواعد")).toHaveCount(0);

    await page.goto(`/en/admin/lessons/${slug}/translate`);
    await publish(page);

    await page.goto(`/ar/lessons/${slug}`);
    await expect(
      page.getByRole("heading", { name: "الأحماض والقواعد" }),
    ).toBeVisible();
    await expect(page.getByText("مانح بروتون.")).toBeVisible();
  });

  test("tells an Arabic reader when the English has moved on", async ({
    page,
  }) => {
    await signInAs(page, db, "admin");
    const slug = await lessonToTranslate();

    await page.goto(`/en/admin/lessons/${slug}/translate`);
    const boxes = page.getByRole("textbox");
    await boxes.nth(0).fill("الأحماض والقواعد");
    await boxes.nth(1).fill("نظرة أولى.");
    await boxes.nth(2).fill("ما الحمض؟");
    await boxes.nth(3).fill("مانح بروتون.");
    await page
      .getByRole("button", { name: /save translation/i })
      .first()
      .click();
    await expect(page.getByText(/^Saved$/).first()).toBeVisible({
      timeout: 15_000,
    });
    await publish(page);

    // The English changes underneath it. No marking step runs: the source's
    // hash is a generated column, so Postgres recomputes it inside this
    // statement.
    await db
      .update(schema.lessons)
      .set({ description: "A first look at acids, revised." })
      .where(like(schema.lessons.slug, slug));

    await page.goto(`/ar/lessons/${slug}`);
    // Still Arabic — an out-of-date translation of an article is still mostly
    // the article — but the reader is told.
    await expect(
      page.getByRole("heading", { name: "الأحماض والقواعد" }),
    ).toBeVisible();
    await expect(page.getByText(/قد تكون هذه الترجمة قديمة/)).toBeVisible();
  });
});
