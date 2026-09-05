import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { signInAs } from "./support/accounts";

/**
 * Liking, saving and sharing, through the browser.
 *
 * The claim only a browser can settle is the share rule: that a DISMISSED
 * share sheet posts nothing at all. Everything else about that rule can be
 * unit-tested; whether the button is wired to it cannot.
 */

test.describe.configure({ timeout: 120_000, mode: "serial" });

let db: SeedDatabase;
let close: () => Promise<void>;

const SLUG = "introduction-basics";

test.beforeAll(() => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));
});

test.afterAll(async () => {
  await close?.();
});

async function lessonId(): Promise<string> {
  const [lesson] = await db
    .select({ id: schema.lessons.id })
    .from(schema.lessons)
    .where(eq(schema.lessons.slug, SLUG));
  return lesson!.id;
}

/**
 * Opens the lesson and waits for the engagement bar to be live.
 *
 * The page is prerendered, so its HTML arrives before any JavaScript does — a
 * click that lands before hydration hits a button with no handler attached and
 * silently does nothing. The bar fetches its own state on mount, so that
 * request completing is a precise signal that the component is interactive.
 */
async function openLesson(page: import("@playwright/test").Page) {
  const state = page.waitForResponse(
    (response) =>
      response.url().includes("/engagement") && response.status() === 200,
  );
  await page.goto(`/lessons/${SLUG}`);
  await state;
}

async function userId(email: string): Promise<string> {
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email));
  return user!.id;
}

test.describe("engagement", () => {
  test("prompts a signed-out reader to sign in rather than pretending", async ({
    page,
  }) => {
    await openLesson(page);

    const like = page.getByRole("button", { name: /like/i });
    await expect(like).toBeVisible();
    await like.click();

    // The click was real. A like that appears to work and vanishes on reload
    // is worse than being told what would make it work.
    // `.first()`: sonner renders the toast plus a visually-hidden copy for
    // screen readers, so the text is legitimately on the page twice.
    await expect(page.getByText(/sign in to like/i).first()).toBeVisible();
  });

  test("likes and unlikes, and the count follows", async ({ page }) => {
    const email = await signInAs(page, db, "member");
    const id = await userId(email);
    const lesson = await lessonId();

    await db
      .delete(schema.lessonLikes)
      .where(
        and(
          eq(schema.lessonLikes.lessonId, lesson),
          eq(schema.lessonLikes.userId, id),
        ),
      );

    await openLesson(page);

    const like = page.getByRole("button", { name: /like/i });
    await expect(like).toHaveAttribute("aria-pressed", "false");
    await like.click();
    await expect(like).toHaveAttribute("aria-pressed", "true");

    // Polled, not read once: `aria-pressed` flips OPTIMISTICALLY, before the
    // request finishes, so it is evidence of the click being handled and not
    // of the row existing. Reading the table immediately races the write.
    await expect(async () => {
      const rows = await db
        .select({ userId: schema.lessonLikes.userId })
        .from(schema.lessonLikes)
        .where(
          and(
            eq(schema.lessonLikes.lessonId, lesson),
            eq(schema.lessonLikes.userId, id),
          ),
        );
      expect(rows).toHaveLength(1);
    }).toPass({ timeout: 10_000 });

    await page.getByRole("button", { name: /liked/i }).click();
    await expect(page.getByRole("button", { name: /^like/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("saves a lesson and it appears on the reading list", async ({
    page,
  }) => {
    const email = await signInAs(page, db, "member");
    const id = await userId(email);
    const lesson = await lessonId();

    await db
      .delete(schema.lessonSaves)
      .where(
        and(
          eq(schema.lessonSaves.lessonId, lesson),
          eq(schema.lessonSaves.userId, id),
        ),
      );

    await openLesson(page);
    await page.getByRole("button", { name: /^save/i }).click();
    await expect(page.getByRole("button", { name: /saved/i })).toBeVisible();

    await page.goto("/profile/saved");
    await expect(
      page.getByRole("link", { name: /introduction/i }),
    ).toBeVisible();
  });

  test("a dismissed share sheet posts nothing", async ({ page }) => {
    // The requirement, end to end. Most implementations increment on click,
    // which turns the share count into a click count.
    await signInAs(page, db, "member");
    const lesson = await lessonId();

    await db
      .delete(schema.shareEvents)
      .where(eq(schema.shareEvents.lessonId, lesson));

    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: () => {
          const error = new Error("Share canceled");
          error.name = "AbortError";
          return Promise.reject(error);
        },
      });
    });

    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/share")) {
        posts.push(request.url());
      }
    });

    await openLesson(page);
    await page.getByRole("button", { name: /share/i }).click();
    await page.waitForTimeout(1000);

    expect(posts).toEqual([]);
    const rows = await db
      .select({ id: schema.shareEvents.id })
      .from(schema.shareEvents)
      .where(eq(schema.shareEvents.lessonId, lesson));
    expect(rows).toHaveLength(0);
  });

  test("a resolved share sheet records one verified share", async ({
    page,
  }) => {
    await signInAs(page, db, "member");
    const lesson = await lessonId();

    await db
      .delete(schema.shareEvents)
      .where(eq(schema.shareEvents.lessonId, lesson));

    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: () => Promise.resolve(),
      });
    });

    await openLesson(page);
    await page.getByRole("button", { name: /share/i }).click();

    await expect(async () => {
      const rows = await db
        .select({
          channel: schema.shareEvents.channel,
          verified: schema.shareEvents.verified,
        })
        .from(schema.shareEvents)
        .where(eq(schema.shareEvents.lessonId, lesson));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.channel).toBe("web_share");
      expect(rows[0]!.verified).toBe(true);
    }).toPass({ timeout: 10_000 });
  });

  test("refuses a forged share channel", async ({ page }) => {
    // The client sends a channel, never a verified flag and never a count. A
    // client that could say "this one counts" can inflate the number.
    await signInAs(page, db, "member");

    const response = await page.request.post(`/api/lessons/${SLUG}/share`, {
      data: { channel: "definitely_a_real_share", verified: true },
    });
    expect(response.status()).toBe(400);
  });

  test("refuses a like on a slug nobody published", async ({ page }) => {
    await signInAs(page, db, "member");
    const response = await page.request.post(
      `/api/lessons/not-a-lesson-${Date.now()}/like`,
    );
    expect(response.status()).toBe(404);
  });
});
