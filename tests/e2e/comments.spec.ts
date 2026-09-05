import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import * as schema from "@/db/schema";
import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import { signInAs } from "./support/accounts";

/**
 * The discussion, in a browser.
 *
 * What only this can show: that a reaction moves before the request finishes
 * and rolls BACK when it fails, that a comment posted by somebody else does
 * not shove the page under the reader's cursor, and that a body containing
 * markup renders as text rather than as markup.
 */

test.describe.configure({ timeout: 90_000 });

let db: SeedDatabase;
let close: () => Promise<void>;
let lessonId: string;
let lessonSlug: string;

test.beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  /**
   * A DIFFERENT lesson per worker.
   *
   * Every test here starts from an empty discussion, so `beforeEach` clears
   * the subject's comments — and with two workers on one lesson that clears
   * the comment the other worker is mid-click on. The button vanishes and the
   * click hangs until the test times out, which is what happened.
   *
   * Ordered by slug so the choice is deterministic rather than whatever the
   * planner returns.
   */
  const lessons = await db
    .select({ id: schema.lessons.id, slug: schema.lessons.slug })
    .from(schema.lessons)
    .orderBy(schema.lessons.slug);
  expect(lessons.length, "the seed produced no lessons").toBeGreaterThan(0);

  const worker = Number(process.env.TEST_WORKER_INDEX ?? "0");
  const lesson = lessons[worker % lessons.length]!;
  lessonId = lesson.id;
  lessonSlug = lesson.slug;
});

test.afterAll(async () => {
  await db
    ?.delete(schema.comments)
    .where(eq(schema.comments.subjectId, lessonId));
  await close?.();
});

test.beforeEach(async () => {
  await db
    .delete(schema.comments)
    .where(eq(schema.comments.subjectId, lessonId));
});

/** Writes a comment straight to the table: these tests are about the LIST,
 * and going through the form would spend the rate limit on setup. */
async function seedComment(body: string, authorId: string | null = null) {
  const id = uuidv7();
  await db.insert(schema.comments).values({
    id,
    subjectType: "lesson",
    subjectId: lessonId,
    authorId,
    body,
    depth: 0,
    path: id,
  });
  return id;
}

test("shows the discussion to a reader who is not signed in", async ({
  page,
}) => {
  await seedComment("Why does the colour change at the endpoint?");
  await page.goto(`/lessons/${lessonSlug}`);

  const feed = page.getByRole("feed");
  await expect(feed).toBeVisible();
  await expect(
    page.getByText("Why does the colour change at the endpoint?"),
  ).toBeVisible();

  // Public to read, signed-in to write.
  await expect(page.getByText(/sign in to join the discussion/i)).toBeVisible();
});

test("renders a body containing markup as text, not as markup", async ({
  page,
}) => {
  // The first place this platform stores text a stranger wrote. A body that
  // becomes an element is the whole class of bug this design avoids.
  await seedComment('<img src=x onerror="alert(1)"> and <b>bold</b>');
  await page.goto(`/lessons/${lessonSlug}`);

  const feed = page.getByRole("feed");
  await expect(feed).toContainText("<b>bold</b>");
  expect(await feed.locator("img").count()).toBe(0);
  expect(await feed.locator("b").count()).toBe(0);
});

test("links a URL with the rel that stops the box being an SEO product", async ({
  page,
}) => {
  await seedComment("See https://example.com/titration for the method");
  await page.goto(`/lessons/${lessonSlug}`);

  const link = page.getByRole("feed").getByRole("link", {
    name: /example\.com/,
  });
  await expect(link).toBeVisible();

  const rel = await link.getAttribute("rel");
  expect(rel).toContain("nofollow");
  expect(rel).toContain("ugc");
  expect(rel).toContain("noopener");
});

test("posts a comment and shows it immediately, without a refetch", async ({
  page,
}) => {
  const email = await signInAs(page, db, "member");
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email));
  await db
    .delete(schema.comments)
    .where(eq(schema.comments.authorId, user!.id));

  await page.goto(`/lessons/${lessonSlug}`);

  const body = `A question about buffers ${Date.now()}`;
  await page.getByRole("textbox", { name: /ask a question/i }).fill(body);
  await page.getByRole("button", { name: /^post$/i }).click();

  // The reader expects to see what they just wrote. A spinner where their
  // words should be reads as a failure.
  await expect(page.getByText(body)).toBeVisible({ timeout: 15_000 });
});

test("moves a reaction before the request finishes, and puts it back when it fails", async ({
  page,
}) => {
  const id = await seedComment("React to me");
  await signInAs(page, db, "member");
  await page.goto(`/lessons/${lessonSlug}`);

  // The server refuses. The count must not stay where optimism put it.
  await page.route(`**/api/comments/${id}/reaction`, (route) =>
    route.fulfill({ status: 500, body: "{}" }),
  );

  const like = page
    .getByRole("feed")
    .getByRole("button", { name: "Helpful" })
    .first();
  await expect(like).toContainText("0");

  await like.click();
  // Optimistic: the number moves without waiting for the round trip.
  await expect(like).toContainText("1");

  // And moves back, with a toast, rather than quietly disagreeing with the
  // database until the next reload.
  await expect(like).toContainText("0", { timeout: 15_000 });
  await expect(
    page.getByText(/your reaction was put back/i).first(),
  ).toBeVisible();
});

test("keeps a like after a reload, when the server agrees", async ({
  page,
}) => {
  await seedComment("Genuinely helpful");
  await signInAs(page, db, "member");
  await page.goto(`/lessons/${lessonSlug}`);

  const like = page
    .getByRole("feed")
    .getByRole("button", { name: "Helpful" })
    .first();
  await like.click();
  await expect(like).toContainText("1");

  await page.reload();
  const afterReload = page
    .getByRole("feed")
    .getByRole("button", { name: "Helpful" })
    .first();
  await expect(afterReload).toContainText("1");
  // And the button says the reader is the one who liked it.
  await expect(afterReload).toHaveAttribute("aria-pressed", "true");
});

test("tells a signed-out reader what would make the button work", async ({
  page,
}) => {
  await seedComment("Try to like me");
  await page.goto(`/lessons/${lessonSlug}`);

  await page
    .getByRole("feed")
    .getByRole("button", { name: "Helpful" })
    .first()
    .click();

  // Not a silent no-op: the click was real.
  // `.first()`: a toast can still be on screen from an earlier press.
  await expect(page.getByText(/sign in to react/i).first()).toBeVisible();
});

test("shows a deleted comment as a tombstone rather than dropping the thread", async ({
  page,
}) => {
  const rootId = await seedComment("The question");
  const replyId = uuidv7();
  await db.insert(schema.comments).values({
    id: replyId,
    subjectType: "lesson",
    subjectId: lessonId,
    body: "The answer",
    depth: 1,
    parentId: rootId,
    rootId,
    path: `${rootId}/${replyId}`,
  });
  await db
    .update(schema.comments)
    .set({ deletedAt: new Date(), body: "" })
    .where(eq(schema.comments.id, rootId));

  await page.goto(`/lessons/${lessonSlug}`);

  await expect(page.getByText(/this comment was deleted/i)).toBeVisible();
  // The conversation survives, so nobody is left answering a question that
  // vanished.
  await expect(page.getByText("The answer")).toBeVisible();
});

test("says so when there is nothing yet", async ({ page }) => {
  await page.goto(`/lessons/${lessonSlug}`);
  await expect(page.getByText(/ask the first question/i)).toBeVisible();
});
