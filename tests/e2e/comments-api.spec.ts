import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import { signInAs } from "./support/accounts";

/**
 * The comment API, against the running app.
 *
 * The integration tests cover the queries. What only the HTTP layer can show
 * is the half a client actually meets: that reading is public and writing is
 * not, that the rate limit is enforced where a client cannot reach it, and
 * that a hidden comment is absent from the RESPONSE rather than filtered in
 * the browser.
 */

test.describe.configure({ timeout: 90_000 });

let db: SeedDatabase;
let close: () => Promise<void>;
let lessonId: string;

test.beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  const [lesson] = await db
    .select({ id: schema.lessons.id })
    .from(schema.lessons)
    .limit(1);
  expect(lesson, "the seed produced no lessons").toBeTruthy();
  lessonId = lesson!.id;
});

test.afterAll(async () => {
  await db
    ?.delete(schema.comments)
    .where(eq(schema.comments.subjectId, lessonId));
  await close?.();
});

/** A body nobody else will post, so the duplicate check cannot fire between
 * tests sharing this worker's account. */
const unique = (prefix: string) =>
  `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function clearMine(email: string) {
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email));
  if (user) {
    await db
      .delete(schema.comments)
      .where(eq(schema.comments.authorId, user.id));
  }
}

test.describe("reading", () => {
  test("is public — a discussion nobody can read never starts", async ({
    page,
  }) => {
    await page.goto("/");
    const response = await page.request.get(
      `/api/comments?subjectType=lesson&subjectId=${lessonId}`,
    );

    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty("items");
    // Per-viewer and constantly changing: never cached by a proxy.
    expect(response.headers()["cache-control"]).toContain("no-store");
  });

  test("refuses a subject it does not know", async ({ page }) => {
    await page.goto("/");
    const response = await page.request.get(
      "/api/comments?subjectType=planet&subjectId=" + lessonId,
    );
    expect(response.status()).toBe(400);
  });

  test("treats a tampered cursor as a bad request, not a server error", async ({
    page,
  }) => {
    await page.goto("/");
    // It goes straight into a WHERE clause, so this is the one that matters.
    const response = await page.request.get(
      `/api/comments?subjectType=lesson&subjectId=${lessonId}&cursor=${"x".repeat(600)}`,
    );
    expect(response.status()).toBe(400);
  });
});

test.describe("posting", () => {
  test("needs a session", async ({ page }) => {
    await page.goto("/");
    const response = await page.request.post("/api/comments", {
      data: { subjectType: "lesson", subjectId: lessonId, body: unique("hi") },
    });
    expect(response.status()).toBe(401);
  });

  test("stores what was written and returns it to a reader", async ({
    page,
  }) => {
    const email = await signInAs(page, db, "member");
    await clearMine(email);

    const body = unique("A real question about titration");
    const created = await page.request.post("/api/comments", {
      data: { subjectType: "lesson", subjectId: lessonId, body },
    });
    expect(created.status()).toBe(201);

    const list = await page.request.get(
      `/api/comments?subjectType=lesson&subjectId=${lessonId}`,
    );
    const payload = (await list.json()) as { items: { body: string }[] };
    expect(payload.items.map((item) => item.body)).toContain(body);
  });

  test("enforces the rate limit where a client cannot reach it", async ({
    page,
  }) => {
    // The acceptance criterion: server-side, and not bypassable by calling the
    // API directly — which is exactly what this test does.
    const email = await signInAs(page, db, "member");
    await clearMine(email);

    for (let i = 0; i < 3; i++) {
      const response = await page.request.post("/api/comments", {
        data: {
          subjectType: "lesson",
          subjectId: lessonId,
          body: unique(`burst ${i}`),
        },
      });
      expect(response.status(), `burst ${i}`).toBe(201);
    }

    const refused = await page.request.post("/api/comments", {
      data: {
        subjectType: "lesson",
        subjectId: lessonId,
        body: unique("one too many"),
      },
    });

    expect(refused.status()).toBe(429);
    // An honest number the client can act on, not a guess.
    expect(Number(refused.headers()["retry-after"])).toBeGreaterThan(0);
  });

  test("refuses the same body twice", async ({ page }) => {
    const email = await signInAs(page, db, "member");
    await clearMine(email);

    const body = unique("Exactly the same thing");
    expect(
      (
        await page.request.post("/api/comments", {
          data: { subjectType: "lesson", subjectId: lessonId, body },
        })
      ).status(),
    ).toBe(201);

    const again = await page.request.post("/api/comments", {
      data: { subjectType: "lesson", subjectId: lessonId, body },
    });

    // A double-submitted form and a copy-paste spam run look identical from
    // the server, and neither should produce two rows.
    expect(again.status()).toBe(429);
    expect((await again.json()).error).toBe("duplicate");
  });

  test("refuses a body that is not a comment", async ({ page }) => {
    const email = await signInAs(page, db, "member");
    await clearMine(email);

    for (const body of ["", "   \n  ", "a"]) {
      const response = await page.request.post("/api/comments", {
        data: { subjectType: "lesson", subjectId: lessonId, body },
      });
      expect(response.status(), JSON.stringify(body)).toBe(400);
    }
  });
});

test.describe("moderation and tombstones", () => {
  test("a hidden comment is absent from the response, not filtered in the client", async ({
    page,
  }) => {
    const email = await signInAs(page, db, "member");
    await clearMine(email);

    const body = unique("Hide this one");
    const created = await page.request.post("/api/comments", {
      data: { subjectType: "lesson", subjectId: lessonId, body },
    });
    const { id } = (await created.json()) as { id: string };

    await db
      .update(schema.comments)
      .set({ status: "hidden" })
      .where(eq(schema.comments.id, id));

    const list = await page.request.get(
      `/api/comments?subjectType=lesson&subjectId=${lessonId}`,
    );
    // The whole response body, not just the parsed items: "removed" that
    // anybody can read in devtools is not removed.
    expect(await list.text()).not.toContain(body);
  });

  test("a deleted comment with replies keeps the thread and loses the content", async ({
    page,
  }) => {
    const email = await signInAs(page, db, "member");
    await clearMine(email);

    const rootBody = unique("The question");
    const root = await page.request.post("/api/comments", {
      data: { subjectType: "lesson", subjectId: lessonId, body: rootBody },
    });
    const { id: rootId } = (await root.json()) as { id: string };

    // The reply is written directly: the rate limiter would refuse a second
    // post this quickly, and this test is about deletion, not about pace.
    const [author] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email));
    await db.insert(schema.comments).values({
      id: crypto.randomUUID(),
      subjectType: "lesson",
      subjectId: lessonId,
      authorId: author!.id,
      body: "The answer",
      depth: 1,
      parentId: rootId,
      rootId,
      path: `${rootId}/x`,
    });

    expect((await page.request.delete(`/api/comments/${rootId}`)).ok()).toBe(
      true,
    );

    const list = await page.request.get(
      `/api/comments?subjectType=lesson&subjectId=${lessonId}`,
    );
    const text = await list.text();

    expect(text).not.toContain(rootBody);
    // The thread survives, so nobody is left answering a question that
    // vanished.
    expect(text).toContain("The answer");
  });

  test("somebody else's comment is a 404, not a 403", async ({ page }) => {
    // A 403 confirms the id exists and that somebody else wrote it — a small
    // oracle for enumerating a thread's authorship, and useless to a stranger
    // either way.
    const email = await signInAs(page, db, "member");
    const [author] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email));

    const strangerId = `e2e-comment-stranger-w${process.env.TEST_WORKER_INDEX ?? "0"}`;
    await db
      .insert(schema.users)
      .values({
        id: strangerId,
        name: "Stranger",
        email: `${strangerId}@comments-e2e.invalid`,
      })
      .onConflictDoNothing();

    const theirs = crypto.randomUUID();
    await db.insert(schema.comments).values({
      id: theirs,
      subjectType: "lesson",
      subjectId: lessonId,
      authorId: strangerId,
      body: unique("Not yours"),
      depth: 0,
      path: theirs,
    });

    expect(author!.id).not.toBe(strangerId);
    expect(
      (await page.request.delete(`/api/comments/${theirs}`)).status(),
    ).toBe(404);
    expect(
      (
        await page.request.patch(`/api/comments/${theirs}`, {
          data: { body: unique("rewritten") },
        })
      ).status(),
    ).toBe(404);
  });
});

test.describe("reactions", () => {
  test("switching sides leaves one row and moves both counters", async ({
    page,
  }) => {
    const email = await signInAs(page, db, "member");
    await clearMine(email);

    const created = await page.request.post("/api/comments", {
      data: {
        subjectType: "lesson",
        subjectId: lessonId,
        body: unique("React to me"),
      },
    });
    const { id } = (await created.json()) as { id: string };

    expect(
      (
        await page.request.put(`/api/comments/${id}/reaction`, {
          data: { type: "like" },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await page.request.put(`/api/comments/${id}/reaction`, {
          data: { type: "dislike" },
        })
      ).ok(),
    ).toBe(true);

    const [row] = await db
      .select({
        like: schema.comments.likeCount,
        dislike: schema.comments.dislikeCount,
      })
      .from(schema.comments)
      .where(eq(schema.comments.id, id));

    expect(row).toEqual({ like: 0, dislike: 1 });
  });

  test("needs a session, and refuses a reaction that is not one", async ({
    page,
  }) => {
    await page.goto("/");
    const anonymous = await page.request.put(
      `/api/comments/${crypto.randomUUID()}/reaction`,
      { data: { type: "like" } },
    );
    expect(anonymous.status()).toBe(401);

    await signInAs(page, db, "member");
    const nonsense = await page.request.put(
      `/api/comments/${crypto.randomUUID()}/reaction`,
      { data: { type: "shrug" } },
    );
    expect(nonsense.status()).toBe(400);
  });
});
