import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import { signInAs } from "./support/accounts";

/**
 * The inbox, end to end.
 *
 * The integration tests already cover the queries — aggregation, the read
 * cursor, who can see what. What only a browser can show is the half that
 * lives between them and a person: that the sentence is COMPOSED in the
 * reader's locale rather than stored, that a row pointing at something deleted
 * is a tombstone and not a dead link, and that marking everything read
 * survives the round trip instead of only clearing on screen.
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

async function userIdFor(email: string): Promise<string> {
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email));
  expect(user, `no user for ${email}`).toBeTruthy();
  return user!.id;
}

/**
 * A clean inbox for this worker's account.
 *
 * The accounts are reused across runs by design (see support/accounts.ts), so
 * a test that counted rows without clearing them would pass once and then
 * drift — and the unread badge is exactly the kind of assertion that hides
 * that drift behind a plausible-looking number.
 */
async function clearInbox(userId: string) {
  await db
    .delete(schema.notifications)
    .where(eq(schema.notifications.recipientId, userId));
}

async function seedNotification(
  userId: string,
  row: {
    type: "lesson.liked" | "comment.replied";
    subjectId: string;
    data: Record<string, unknown>;
    actorCount?: number;
    actorId?: string | null;
  },
) {
  await db.insert(schema.notifications).values({
    recipientId: userId,
    type: row.type,
    subjectType: "lesson",
    subjectId: row.subjectId,
    actorId: row.actorId ?? null,
    actorCount: row.actorCount ?? 1,
    data: row.data as never,
  });
}

/** The first lesson slug the seed produced — a link that must actually work. */
async function someLessonSlug(): Promise<string> {
  const [lesson] = await db
    .select({ slug: schema.lessons.slug })
    .from(schema.lessons)
    .limit(1);
  expect(lesson, "the seed produced no lessons").toBeTruthy();
  return lesson!.slug;
}

async function signedInMember(page: Page): Promise<string> {
  const email = await signInAs(page, db, "member");
  const userId = await userIdFor(email);
  await clearInbox(userId);
  return userId;
}

/**
 * The page body.
 *
 * Scoped deliberately: the bell in the header announces the same unread count
 * to screen readers, so an unscoped `getByText("No unread notifications")`
 * matches twice and Playwright refuses it. That duplication is correct — both
 * places should say it — so the test names which one it means.
 */
function body(page: Page) {
  return page.getByRole("main");
}

test("an empty inbox says so, rather than showing an empty box", async ({
  page,
}) => {
  await signedInMember(page);
  await page.goto("/notifications");

  await expect(
    page.getByRole("heading", { name: "Notifications" }),
  ).toBeVisible();
  await expect(page.getByText(/nothing yet/i)).toBeVisible();
  // No count to mark read, so no control that would do nothing.
  await expect(
    page.getByRole("button", { name: /mark all read/i }),
  ).toHaveCount(0);
});

test("composes the sentence from the catalogue, and links where it points", async ({
  page,
}) => {
  const userId = await signedInMember(page);
  const slug = await someLessonSlug();

  await seedNotification(userId, {
    type: "lesson.liked",
    subjectId: "lesson-1",
    actorCount: 4,
    data: { lessonSlug: slug },
  });

  await page.goto("/notifications");

  // Four distinct likers: the plural form the CATALOGUE chooses, not a string
  // that was assembled when the row was written.
  const row = page.getByText(/liked your lesson/i);
  await expect(row).toBeVisible();
  await expect(row).toContainText("3 others");

  await expect(body(page).getByText("1 unread notification")).toBeVisible();

  // And it goes somewhere real — a notification that 404s is worse than none.
  await page.getByRole("link", { name: /liked your lesson/i }).click();
  await expect(page).toHaveURL(new RegExp(`/lessons/${slug}$`));
});

test("a notification about something deleted is a tombstone, not a dead link", async ({
  page,
}) => {
  const userId = await signedInMember(page);

  // No lessonSlug and no quizSlug: whatever this was about is gone.
  await seedNotification(userId, {
    type: "comment.replied",
    subjectId: "comment-gone",
    data: {},
  });

  await page.goto("/notifications");

  await expect(page.getByText(/replied to your comment/i)).toBeVisible();
  await expect(page.getByText(/has been removed/i)).toBeVisible();
  await expect(
    page.getByRole("link", { name: /replied to your comment/i }),
  ).toHaveCount(0);
});

test("marking all read survives a reload", async ({ page }) => {
  const userId = await signedInMember(page);
  const slug = await someLessonSlug();

  await seedNotification(userId, {
    type: "lesson.liked",
    subjectId: "lesson-2",
    data: { lessonSlug: slug },
  });

  await page.goto("/notifications");
  await expect(body(page).getByText("1 unread notification")).toBeVisible();

  await page.getByRole("button", { name: /mark all read/i }).click();
  await expect(body(page).getByText("No unread notifications")).toBeVisible();

  // The point of the assertion: it was written down, not only re-rendered.
  await page.reload();
  await expect(body(page).getByText("No unread notifications")).toBeVisible();
  await expect(page.getByText(/liked your lesson/i)).toBeVisible();
});

test("the bell carries the count on a page about something else", async ({
  page,
}) => {
  const userId = await signedInMember(page);
  const slug = await someLessonSlug();

  await seedNotification(userId, {
    type: "lesson.liked",
    subjectId: "lesson-3",
    data: { lessonSlug: slug },
  });

  await page.goto("/");

  const bell = page.getByRole("button", { name: /open notifications/i });
  await expect(bell).toBeVisible();
  // The bell polls on load, so the badge arrives without a reload.
  await expect(bell).toContainText("1");
});

test.describe("the API", () => {
  test("refuses an anonymous caller rather than answering for nobody", async ({
    page,
  }) => {
    await page.goto("/");
    const response = await page.request.get("/api/notifications", {
      headers: { cookie: "" },
    });
    expect(response.status()).toBe(401);
  });

  test("cannot be pointed at somebody else's rows", async ({ page }) => {
    await signedInMember(page);

    // A stranger, written straight to the table: this is about what the
    // endpoint does with an id it was HANDED, so the stranger never needs a
    // session of their own.
    const strangerId = `e2e-stranger-w${process.env.TEST_WORKER_INDEX ?? "0"}`;
    await db
      .insert(schema.users)
      .values({
        id: strangerId,
        name: "Stranger",
        email: `${strangerId}@admin-e2e.invalid`,
      })
      .onConflictDoNothing();

    await db
      .delete(schema.notifications)
      .where(eq(schema.notifications.recipientId, strangerId));
    await seedNotification(strangerId, {
      type: "lesson.liked",
      subjectId: "lesson-stranger",
      data: { lessonSlug: await someLessonSlug() },
    });

    const [theirs] = await db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(eq(schema.notifications.recipientId, strangerId));

    // Marking it read is scoped by the query, so this changes nothing rather
    // than being refused with a message that confirms the id exists.
    const response = await page.request.post("/api/notifications/read", {
      data: { ids: [theirs!.id] },
    });
    expect(response.ok()).toBe(true);
    expect(((await response.json()) as { changed: number }).changed).toBe(0);

    const [after] = await db
      .select({ readAt: schema.notifications.readAt })
      .from(schema.notifications)
      .where(eq(schema.notifications.id, theirs!.id));
    expect(after!.readAt).toBeNull();
  });
});

test.describe("preferences", () => {
  test("a switch is written down, not only flipped on screen", async ({
    page,
  }) => {
    const userId = await signedInMember(page);
    await db
      .delete(schema.notificationPreferences)
      .where(eq(schema.notificationPreferences.userId, userId));

    await page.goto("/profile/settings");

    const label = "Somebody likes a lesson you wrote";
    const toggle = page.getByRole("switch", { name: label });

    // On by default, and reachable by its label rather than its position: a
    // switch nobody can name is a switch a screen reader cannot use.
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeChecked();

    await toggle.click();
    await expect(toggle).not.toBeChecked();

    await page.reload();
    await expect(page.getByRole("switch", { name: label })).not.toBeChecked();

    // And in the row the fan-out actually reads.
    const [row] = await db
      .select({ categories: schema.notificationPreferences.categories })
      .from(schema.notificationPreferences)
      .where(eq(schema.notificationPreferences.userId, userId));
    expect(row!.categories).toMatchObject({ "lesson.liked": false });
  });

  test("sends only the switch that moved", async ({ page }) => {
    // Two tabs open on this page must not have the later save undo the
    // earlier one's unrelated switch, so the request carries one key.
    const userId = await signedInMember(page);
    await db
      .delete(schema.notificationPreferences)
      .where(eq(schema.notificationPreferences.userId, userId));

    await page.goto("/profile/settings");

    const request = page.waitForRequest(
      (candidate) =>
        candidate.url().includes("/api/notifications/preferences") &&
        candidate.method() === "PATCH",
    );
    await page
      .getByRole("switch", { name: "Somebody likes your comment" })
      .click();

    const body = JSON.parse((await request).postData() ?? "{}") as {
      categories: Record<string, boolean>;
    };
    expect(Object.keys(body.categories)).toEqual(["comment.liked"]);
  });
});

test("older notifications load as the list is scrolled", async ({ page }) => {
  const userId = await signedInMember(page);
  const slug = await someLessonSlug();

  // One more than the page size, so there IS a second page. Distinct subjects:
  // the aggregate index folds unread rows sharing one.
  for (let i = 0; i < 25; i++) {
    await seedNotification(userId, {
      type: "lesson.liked",
      subjectId: `lesson-page-${i}`,
      data: { lessonSlug: slug },
    });
  }

  await page.goto("/notifications");

  const rows = page.getByRole("listitem");
  await expect(rows).toHaveCount(20);

  // Scrolling to the end is what a reader does; the observer does the rest.
  await page
    .getByRole("button", { name: /load older/i })
    .scrollIntoViewIfNeeded();
  await expect(rows).toHaveCount(25);

  // And it stops rather than asking for a page that is not there.
  await expect(page.getByRole("button", { name: /load older/i })).toHaveCount(
    0,
  );
});
