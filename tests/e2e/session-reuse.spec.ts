import { expect, test, type Page } from "@playwright/test";
import { and, eq, gt } from "drizzle-orm";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { signInAs } from "./support/accounts";

/**
 * The test HELPER, not the product.
 *
 * `signInAs` caches a worker's session cookies per role and replays them rather
 * than signing in again, because Better Auth rate limits sign-in per identifier
 * and a worker running a dozen admin tests would otherwise make a dozen
 * sign-ins. That cache is load-bearing for the whole admin suite.
 *
 * It used to decide the cache was usable from the COOKIE'S EXPIRY alone. A
 * cookie's expiry says when the browser will stop sending it, never whether the
 * server still honours it — and sessions here are database rows, chosen over
 * stateless tokens precisely so they can be revoked immediately. So an unexpired
 * cookie could name a row that was gone, `signInAs` would report success, and
 * the test would run on as an anonymous visitor and fail later on a selector
 * that was never the problem. That is the shape of a failure seen in this
 * container's full-suite runs.
 *
 * ## Why every assertion here counts database rows
 *
 * The obvious test — revoke the session, call the helper, check the page looks
 * signed in — CANNOT tell the fixed helper from the broken one, and finding that
 * out is most of what this file is worth. `cookieCache` is enabled with a
 * five-minute window (`COOKIE_CACHE_SECONDS`), so within that window the app
 * serves the session from the signed cookie without reading the database: a
 * revoked session still renders as signed in, and `/api/auth/get-session` still
 * names the user. Measured — with the token check removed, the page assertions
 * all passed.
 *
 * What the cookie cache cannot fake is a `sessions` row. A real sign-in writes
 * one; replaying a dead cookie does not. So "did a new session row appear" is the
 * observable that actually separates recovery from false success, and it is what
 * each test below asserts. The page check stays as a smoke test, named as one.
 */

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
  expect(user, `no account for ${email}`).toBeTruthy();
  return user!.id;
}

/** The live session tokens this account holds right now. */
async function liveTokens(userId: string): Promise<string[]> {
  const rows = await db
    .select({ token: schema.sessions.token })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.userId, userId),
        gt(schema.sessions.expiresAt, new Date()),
      ),
    );
  return rows.map((row) => row.token);
}

/**
 * A smoke check, and deliberately labelled as one.
 *
 * It cannot fail for a session revoked less than `COOKIE_CACHE_SECONDS` ago —
 * see the note at the top — so it is here to catch a helper that leaves the page
 * visibly broken, not to prove the fix. The row counts do that.
 */
async function looksSignedIn(page: Page) {
  await page.goto("/en");
  await expect(
    page.getByRole("button", { name: /open notifications/i }),
  ).toBeVisible();
}

test("signs in again when the cached session was revoked server-side", async ({
  page,
}) => {
  const email = await signInAs(page, db, "member");
  const userId = await userIdFor(email);
  const before = await liveTokens(userId);
  expect(before.length).toBeGreaterThan(0);

  // What a sign-out, an admin revocation, or a reseeded database does. The
  // cached cookies are untouched and still unexpired, so the local check passes
  // them happily.
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));

  await signInAs(page, db, "member");

  // A row exists again, which only a real sign-in could have written.
  const after = await liveTokens(userId);
  expect(after.length).toBeGreaterThan(0);
  // And it is a NEW session, not the revoked one somehow back.
  expect(after.some((token) => before.includes(token))).toBe(false);
  await looksSignedIn(page);
});

test("notices when only ITS OWN session was revoked", async ({ page }) => {
  // The difference between "a session for this user exists" and "the session I am
  // about to replay exists". Signing out on one device leaves the others alive,
  // so a check that merely counted the user's sessions would replay a dead cookie
  // and report success.
  const email = await signInAs(page, db, "member");
  const userId = await userIdFor(email);
  const mine = await liveTokens(userId);
  expect(mine.length).toBeGreaterThan(0);

  // A second live session for the same account, standing in for another device.
  // Written directly rather than by signing in again: it never has to be USABLE,
  // only to exist, and a second real sign-in would spend the rate-limit budget
  // this whole cache exists to protect.
  const decoy = `decoy-${Date.now()}`;
  await db.insert(schema.sessions).values({
    id: decoy,
    userId,
    token: decoy,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  try {
    for (const token of mine) {
      await db.delete(schema.sessions).where(eq(schema.sessions.token, token));
    }

    await signInAs(page, db, "member");

    // A session that is neither the decoy nor one of the revoked ones: the
    // helper signed in again rather than trusting the decoy's existence.
    const after = await liveTokens(userId);
    const fresh = after.filter(
      (token) => token !== decoy && !mine.includes(token),
    );
    expect(fresh.length).toBeGreaterThan(0);
  } finally {
    await db.delete(schema.sessions).where(eq(schema.sessions.token, decoy));
  }
});

test("signs in again when the row is present but expired", async ({ page }) => {
  // A worker can outlive a session. The row is still there, so a check that only
  // looked it up by token would call it live; the expiry has to be part of the
  // question.
  const email = await signInAs(page, db, "member");
  const userId = await userIdFor(email);
  const mine = await liveTokens(userId);
  expect(mine.length).toBeGreaterThan(0);

  await db
    .update(schema.sessions)
    .set({ expiresAt: new Date(Date.now() - 60 * 1000) })
    .where(eq(schema.sessions.userId, userId));

  await signInAs(page, db, "member");

  const after = await liveTokens(userId);
  expect(after.length).toBeGreaterThan(0);
  expect(after.some((token) => mine.includes(token))).toBe(false);
});

test("signs in again when the cached token belongs to somebody else", async ({
  page,
}) => {
  // Constructed, and said so: the email join is defence in depth against a cache
  // that somehow held another account's cookies. There is no ordinary route to
  // that state, but an unpinned condition is one somebody deletes as dead code —
  // and the failure it prevents is a test running as the wrong person, which is
  // the quiet version of this bug rather than the loud one.
  const email = await signInAs(page, db, "member");
  const userId = await userIdFor(email);
  const mine = await liveTokens(userId);
  expect(mine.length).toBeGreaterThan(0);

  const otherEmail = await signInAs(page, db, "editor");
  const otherId = await userIdFor(otherEmail);
  expect(otherId).not.toBe(userId);

  // Re-point the member's session row at the editor. The token the cache holds
  // still resolves to a live row — just not to the account it was cached for.
  await db
    .update(schema.sessions)
    .set({ userId: otherId })
    .where(eq(schema.sessions.token, mine[0]!));

  await signInAs(page, db, "member");

  const after = await liveTokens(userId);
  expect(after.length).toBeGreaterThan(0);
  expect(after.some((token) => mine.includes(token))).toBe(false);
});
