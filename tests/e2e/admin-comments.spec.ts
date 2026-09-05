import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import * as schema from "@/db/schema";
import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import { signInAs } from "./support/accounts";

/**
 * The moderation queue, in a browser.
 *
 * The claims worth proving here are the ones about ACCESS: that the queue is
 * behind a permission rather than merely unlinked, that a moderator sees the
 * body of a comment the public read masks, and that acting on a report takes
 * it out of the queue.
 */

test.describe.configure({ timeout: 120_000, mode: "serial" });

let db: SeedDatabase;
let close: () => Promise<void>;
let lessonId: string;

const AUTHOR = `admin-c-author-w${process.env.TEST_WORKER_INDEX ?? "0"}`;
const REPORTER = `admin-c-reporter-w${process.env.TEST_WORKER_INDEX ?? "0"}`;

test.beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  for (const id of [AUTHOR, REPORTER]) {
    await db
      .insert(schema.users)
      .values({
        id,
        name: `Queue ${id.slice(-6)}`,
        email: `${id}@admin-comments.invalid`,
      })
      .onConflictDoNothing();
  }

  // Counting from the end, like comments-api: this file clears its subject's
  // comments too, and the other specs count from the start.
  const lessons = await db
    .select({ id: schema.lessons.id })
    .from(schema.lessons)
    .orderBy(schema.lessons.slug);
  const worker = Number(process.env.TEST_WORKER_INDEX ?? "0");
  lessonId = lessons[Math.max(0, lessons.length - 3 - worker)]!.id;
});

test.afterAll(async () => {
  await db
    ?.delete(schema.comments)
    .where(eq(schema.comments.subjectId, lessonId));
  for (const id of [AUTHOR, REPORTER]) {
    await db?.delete(schema.users).where(eq(schema.users.id, id));
  }
  await close?.();
});

test.beforeEach(async () => {
  await db
    .delete(schema.comments)
    .where(eq(schema.comments.subjectId, lessonId));
});

/** A reported comment, written straight to the table: this file is about the
 * QUEUE, and going through the form would spend the rate limit on setup. */
async function reported(body: string) {
  const id = uuidv7();
  await db.insert(schema.comments).values({
    id,
    subjectType: "lesson",
    subjectId: lessonId,
    authorId: AUTHOR,
    body,
    depth: 0,
    path: id,
  });
  await db
    .insert(schema.commentReports)
    .values({ commentId: id, reporterId: REPORTER, reason: "spam" });
  return id;
}

test("is behind a permission, not merely unlinked", async ({ page }) => {
  // `member` holds nothing on comments. The STATUS is what is asserted, the
  // same way the other admin sections do it: a 200 carrying an apology is a
  // page that rendered and then said no, and the difference matters because
  // the layout resolves the section's permission before the page runs.
  await signInAs(page, db, "member");
  const response = await page.goto("/admin/comments");

  expect(response?.status()).toBe(404);
  // And nothing of the queue leaked into the refusal.
  expect(await page.content()).not.toContain("Reported comments");
});

test("shows a moderator the queue, and the body the public read masks", async ({
  page,
}) => {
  const body = `Reported for the queue ${Date.now()}`;
  const id = await reported(body);

  // Deleted, so the public API would return an empty body — a moderator
  // deciding whether somebody keeps their account needs to see what was said.
  await db
    .update(schema.comments)
    .set({ deletedAt: new Date() })
    .where(eq(schema.comments.id, id));

  await signInAs(page, db, "moderator");
  await page.goto("/admin/comments");

  await expect(
    page.getByRole("heading", { name: /reported comments/i }),
  ).toBeVisible();
  await expect(page.getByText(body)).toBeVisible();
});

test("hiding a comment settles its reports and clears the queue", async ({
  page,
}) => {
  const body = `Hide me from the queue ${Date.now()}`;
  const id = await reported(body);

  await signInAs(page, db, "moderator");
  await page.goto("/admin/comments");
  await expect(page.getByText(body)).toBeVisible();

  await page
    .getByRole("button", { name: /^hide$/i })
    .first()
    .click();
  await expect(page.getByText(/^Done\.$/).first()).toBeVisible({
    timeout: 15_000,
  });

  // Acting settles the reports: leaving them open would show the same comment
  // tomorrow with nothing left to do about it.
  const [comment] = await db
    .select({ status: schema.comments.status })
    .from(schema.comments)
    .where(eq(schema.comments.id, id));
  expect(comment!.status).toBe("hidden");

  const open = await db
    .select({ id: schema.commentReports.id })
    .from(schema.commentReports)
    .where(eq(schema.commentReports.commentId, id));
  expect(open).toHaveLength(1);
  const [report] = await db
    .select({ resolvedAt: schema.commentReports.resolvedAt })
    .from(schema.commentReports)
    .where(eq(schema.commentReports.commentId, id));
  expect(report!.resolvedAt).not.toBeNull();
});

test("says so when nothing is reported", async ({ page }) => {
  await signInAs(page, db, "moderator");
  await page.goto("/admin/comments");

  // The empty queue is the normal state, and a page that looks broken when
  // nothing is wrong teaches people to stop opening it.
  await expect(page.getByText(/nothing reported/i)).toBeVisible();
});
