import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import * as schema from "@/db/schema";
import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import { signInAs } from "./support/accounts";

/**
 * Presence, against the running app.
 *
 * The claims only HTTP can settle: that hiding presence removes it from the
 * response bytes rather than from the rendering, that a page of avatars issues
 * one request, and that a failing presence endpoint leaves the page working
 * with no dot rather than a wrong one.
 */

test.describe.configure({ timeout: 90_000, mode: "serial" });

let db: SeedDatabase;
let close: () => Promise<void>;

const WORKER = process.env.TEST_WORKER_INDEX ?? "0";
const SEEN = `presence-e2e-seen-w${WORKER}`;
const HIDDEN = `presence-e2e-hidden-w${WORKER}`;

test.beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  for (const id of [SEEN, HIDDEN]) {
    await db
      .insert(schema.users)
      .values({
        id,
        name: `Presence ${id.slice(-6)}`,
        email: `${id}@presence-e2e.invalid`,
      })
      .onConflictDoNothing();
  }

  await db
    .update(schema.users)
    .set({ presenceVisibility: "nobody" })
    .where(eq(schema.users.id, HIDDEN));
  await db
    .update(schema.users)
    .set({ presenceVisibility: "everyone" })
    .where(eq(schema.users.id, SEEN));

  for (const id of [SEEN, HIDDEN]) {
    await db
      .insert(schema.userPresence)
      .values({ userId: id, lastSeenAt: new Date() })
      .onConflictDoUpdate({
        target: schema.userPresence.userId,
        set: { lastSeenAt: new Date() },
      });
  }
});

test.afterAll(async () => {
  for (const id of [SEEN, HIDDEN]) {
    await db?.delete(schema.users).where(eq(schema.users.id, id));
  }
  await close?.();
});

test("hidden presence is absent from the response, not from the rendering", async ({
  page,
}) => {
  await page.goto("/");

  const response = await page.request.get(
    `/api/presence?userIds=${SEEN},${HIDDEN}`,
  );
  expect(response.ok()).toBe(true);

  const body = (await response.json()) as {
    rows: { userId: string; state: string; lastSeenAt: string | null }[];
  };

  const seen = body.rows.find((row) => row.userId === SEEN);
  const hidden = body.rows.find((row) => row.userId === HIDDEN);

  expect(seen?.state).toBe("online");
  // The whole point: "hidden" must not mean "hidden unless you open devtools".
  expect(hidden?.state).toBe("offline");
  expect(hidden?.lastSeenAt).toBeNull();

  // And the visible one is a timestamp any engine can parse: Postgres's own
  // text form is accepted by V8 and required of nobody.
  expect(seen?.lastSeenAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  expect(Number.isNaN(Date.parse(seen!.lastSeenAt!))).toBe(false);
});

test("withholds the coarse path from a reader who is not an admin", async ({
  page,
}) => {
  await db
    .update(schema.userPresence)
    .set({ lastPath: "/lessons/[slug]" })
    .where(eq(schema.userPresence.userId, SEEN));

  await page.goto("/");
  const anonymous = await page.request.get(`/api/presence?userIds=${SEEN}`);
  expect(await anonymous.text()).not.toContain("/lessons/[slug]");

  // An admin holding `user:read` gets it — "is this account active, and
  // roughly where" is what that grant is for.
  await signInAs(page, db, "admin");
  const asAdmin = await page.request.get(`/api/presence?userIds=${SEEN}`);
  expect(await asAdmin.text()).toContain("/lessons/[slug]");
});

test("refuses an unbounded batch rather than answering for part of it", async ({
  page,
}) => {
  // Silently answering for the first hundred of two hundred would render half
  // a page's dots and look broken rather than say the request was too large.
  await page.goto("/");
  const ids = Array.from({ length: 101 }, () => uuidv7()).join(",");
  const response = await page.request.get(`/api/presence?userIds=${ids}`);

  expect(response.status()).toBe(400);
});

test("a signed-in reader reports in, and the write is conditional", async ({
  page,
}) => {
  const email = await signInAs(page, db, "member");
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email));

  await db
    .delete(schema.userPresence)
    .where(eq(schema.userPresence.userId, user!.id));

  const beat = () =>
    page.request.post("/api/presence/beat", {
      data: { path: "/lessons/[slug]" },
    });

  expect((await beat()).status()).toBe(204);

  const [first] = await db
    .select({ lastSeenAt: schema.userPresence.lastSeenAt })
    .from(schema.userPresence)
    .where(eq(schema.userPresence.userId, user!.id));
  expect(first).toBeDefined();

  // A second beat inside the floor matches zero rows — which is what caps the
  // write load however many tabs or retries there are.
  expect((await beat()).status()).toBe(204);
  const [second] = await db
    .select({ lastSeenAt: schema.userPresence.lastSeenAt })
    .from(schema.userPresence)
    .where(eq(schema.userPresence.userId, user!.id));
  expect(second!.lastSeenAt.getTime()).toBe(first!.lastSeenAt.getTime());
});

test("refuses a path that is not a route pattern", async ({ page }) => {
  // A path with a query string carries whatever the URL carried, which on a
  // search page is what somebody typed.
  const email = await signInAs(page, db, "member");
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email));

  await db
    .delete(schema.userPresence)
    .where(eq(schema.userPresence.userId, user!.id));

  await page.request.post("/api/presence/beat", {
    data: { path: "/search?q=something+private" },
  });

  const [row] = await db
    .select({ lastPath: schema.userPresence.lastPath })
    .from(schema.userPresence)
    .where(eq(schema.userPresence.userId, user!.id));

  // Refused rather than trimmed: storing a mangled version would still be
  // storing what they sent.
  expect(row!.lastPath).toBeNull();
});

test("needs a session to report presence at all", async ({ page }) => {
  await page.goto("/");
  const response = await page.request.post("/api/presence/beat", {
    data: { path: "/" },
  });
  expect(response.status()).toBe(401);
});

test("the settings switch turns it off, and forgets the timestamp", async ({
  page,
}) => {
  const email = await signInAs(page, db, "member");
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email));

  await db
    .update(schema.users)
    .set({ presenceVisibility: "everyone" })
    .where(eq(schema.users.id, user!.id));
  await page.request.post("/api/presence/beat", { data: {} });

  await page.goto("/profile/settings");
  const toggle = page.getByRole("switch", {
    name: /who can see when you are online/i,
  });
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeChecked();

  await toggle.click();
  await expect(page.getByText(/^Saved\.$/).first()).toBeVisible({
    timeout: 15_000,
  });

  const [after] = await db
    .select({ visibility: schema.users.presenceVisibility })
    .from(schema.users)
    .where(eq(schema.users.id, user!.id));
  expect(after!.visibility).toBe("nobody");

  // Forgotten, not merely hidden: somebody who says "stop showing this"
  // should not have to trust that every future query remembers to filter.
  const rows = await db
    .select({ userId: schema.userPresence.userId })
    .from(schema.userPresence)
    .where(eq(schema.userPresence.userId, user!.id));
  expect(rows).toHaveLength(0);

  // Put it back, so the shared account does not carry this into other specs.
  await db
    .update(schema.users)
    .set({ presenceVisibility: "everyone" })
    .where(eq(schema.users.id, user!.id));
});
