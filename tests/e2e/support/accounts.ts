import { expect, type BrowserContext, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import type { SeedDatabase } from "@/db/seed/connect";

/**
 * Test accounts, created through the API rather than the sign-up form.
 *
 * Driving the form is the right way to test the FORM, and `auth.spec.ts` does
 * exactly that. Everywhere else it is a slow detour — and Better Auth rate
 * limits sign-up to a handful per window, correctly, so a suite that signs up
 * once per test starts getting 429s the moment it runs in parallel. Weakening
 * the limiter to suit the tests would be weakening the product.
 *
 * `page.request` shares a cookie jar with the browser context, so the session
 * this creates is the one the page then navigates with.
 */

export const TEST_PASSWORD = "correct-horse-battery";

/** `.invalid` is reserved, so these can never collide with a real address. */
export function uniqueEmail(prefix: string): string {
  return `e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@admin-e2e.invalid`;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** What a sign-up attempt turned into. */
export type SignUpOutcome = "created" | "exists";

/**
 * Signs up, retrying while the rate limiter says no.
 *
 * The 429 is the product working. Backing off is what a real client would do,
 * and it keeps the suite honest about the limit existing.
 *
 * The backoff is JITTERED, which is the part that matters with more than one
 * worker: several workers rejected at the same moment and sleeping for exactly
 * the same interval wake together and collide again, so a fixed schedule turns
 * one burst into several. Randomising each wait spreads them out.
 *
 * An account that already exists is an OUTCOME, not an error. Two workers
 * racing to create the shared account for a role is normal, and the loser has
 * nothing to recover from — the account it wanted is there.
 */
export async function signUpViaApi(
  page: Page,
  email: string,
): Promise<SignUpOutcome> {
  let lastStatus = 0;

  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await page.request.post("/api/auth/sign-up/email", {
      data: { email, password: TEST_PASSWORD, name: "E2E Probe" },
      headers: {
        Origin: new URL(page.url() || "http://localhost:3000").origin,
      },
    });
    lastStatus = response.status();
    if (response.ok()) return "created";
    // 422: Better Auth's "that address is taken".
    if (lastStatus === 422) return "exists";
    if (lastStatus !== 429) break;
    await sleep(1_200 * (attempt + 1) + Math.random() * 1_200);
  }

  throw new Error(`sign-up for ${email} failed with ${lastStatus}`);
}

/** Grants a role directly: the admin UI for doing so is a later issue. */
export async function grantRole(
  db: SeedDatabase,
  email: string,
  roleKey: string,
): Promise<void> {
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email));
  const [role] = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(eq(schema.roles.key, roleKey));

  expect(user, `no user for ${email}`).toBeTruthy();
  expect(role, `no role ${roleKey}`).toBeTruthy();

  await db
    .insert(schema.userRoles)
    .values({ userId: user!.id, roleId: role!.id })
    .onConflictDoNothing();
}

/**
 * Signs an existing account in, retrying while the limiter says no.
 *
 * Sign-in is rate limited too, and a 429 is NOT a wrong password — treating
 * the two the same is what made a shared account look like a broken one:
 * several workers signing in as the same role at the same moment are refused
 * for pace, and a caller that reads that as "no such account" goes on to sign
 * up an account that already exists.
 */
async function signInViaApi(page: Page, email: string): Promise<boolean> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await page.request.post("/api/auth/sign-in/email", {
      data: { email, password: TEST_PASSWORD },
      headers: {
        Origin: new URL(page.url() || "http://localhost:3000").origin,
      },
    });

    if (response.ok()) return true;
    // Anything else — 401 for an account that does not exist, 403 — is a real
    // answer and retrying it would only waste the window.
    if (response.status() !== 429) return false;

    await sleep(1_200 * (attempt + 1) + Math.random() * 1_200);
  }
  return false;
}

/**
 * One account per role, per worker.
 *
 * Module scope, so it is per worker process — Playwright gives each test a
 * fresh browser context but reuses the worker. Every admin test signing up its
 * own account meant a dozen-plus sign-ups per run against a limiter sized for
 * a handful, and the suite started failing on 429s as it grew.
 *
 * The address is deterministic per (role, worker) — no timestamp. Two
 * properties fall out of that, and both were learned the hard way:
 *
 * - **No timestamp** means the account is reused across RUNS. Against a
 *   database that persists, the first run signs up and every run after it
 *   only signs in, so the sign-up limiter is never approached at all.
 * - **Per worker** means no two workers ever compete for one identifier. A
 *   single shared account per role looked tidier and was worse: the limiter
 *   is per identifier, so concentrating every worker's traffic on one address
 *   is the fastest way to have it refused, and the suite failed that way.
 *
 * Sign-UP comes first and sign-in only after it reports the address taken.
 * The order matters: our own limiter locks an identifier after five failed
 * sign-ins in a window, so opening with a doomed sign-in against an account
 * that does not exist yet spends that budget for nothing.
 */
const accountsByRole = new Map<string, string>();

/**
 * The cookies of a session already established for a role, in this worker.
 *
 * Playwright gives each test a fresh browser context — a fresh cookie jar — so
 * without this every test signs in again, and a worker running a dozen admin
 * tests makes a dozen sign-in requests as the same identifier. Better Auth
 * rate limits that, correctly, and the suite starts failing on 429s that have
 * nothing to do with what is being tested. Weakening the limiter to suit the
 * tests would be weakening the product.
 *
 * Replaying the cookies is what a returning browser does, and it exercises the
 * same session rows the sign-in created. `auth.spec.ts` still drives the real
 * form and the real endpoint, so the sign-in path itself stays covered.
 *
 * One hazard to know about: a test that SIGNS OUT as a shared role deletes the
 * session row these cookies name, and the next test to reuse them would fail
 * somewhere far from the cause. No test does that today — `auth.spec.ts` signs
 * out of its own throwaway account — and one that needs to should sign in with
 * its own address rather than a shared role.
 */
const sessionCookies = new Map<string, Cookie[]>();

/** How Playwright describes a cookie to `addCookies`. */
type Cookie = Awaited<ReturnType<BrowserContext["cookies"]>>[number];

/**
 * Whether a set of cookies still contains a live session.
 *
 * Cookies carry an expiry, and a worker running for several minutes can hold
 * one that has passed. Replaying an expired cookie lands on the sign-in page
 * with an error about the page under test, so the age is checked and a fresh
 * sign-in happens instead.
 */
function stillValid(cookies: Cookie[]): boolean {
  if (cookies.length === 0) return false;
  const now = Date.now() / 1000;
  // `-1` is a session cookie, which does not expire on its own.
  return cookies.every(
    (cookie) => cookie.expires === -1 || cookie.expires > now + 30,
  );
}

/**
 * This worker's address for a role. `.invalid` is reserved, so it can never
 * collide with a real one.
 *
 * Playwright sets `TEST_WORKER_INDEX`; outside a Playwright run there is one
 * notional worker, which keeps the helper usable from a script.
 */
export function accountEmailFor(roleKey: string): string {
  const worker = process.env.TEST_WORKER_INDEX ?? "0";
  return `e2e-${roleKey}-w${worker}@admin-e2e.invalid`;
}

/** Signs up (or reuses) an account holding `roleKey`, leaving it signed in. */
export async function signInAs(
  page: Page,
  db: SeedDatabase,
  roleKey: string,
): Promise<string> {
  // A page needs an origin before `page.request` can resolve a relative URL.
  await page.goto("/");

  const email = accountEmailFor(roleKey);

  // A session this worker already established: replay its cookies rather than
  // spending another sign-in. This is the whole reason the suite stopped
  // tripping the rate limiter — see `sessionCookies` above.
  const known = sessionCookies.get(roleKey);
  if (known && stillValid(known)) {
    await page.context().addCookies(known);
    return email;
  }

  // Known to this worker already: the account exists, so sign in directly.
  if (accountsByRole.has(roleKey)) {
    if (!(await signInViaApi(page, email))) {
      throw new Error(`sign-in for ${email} failed`);
    }
    sessionCookies.set(roleKey, await page.context().cookies());
    return email;
  }

  const outcome = await signUpViaApi(page, email);

  if (outcome === "exists" && !(await signInViaApi(page, email))) {
    throw new Error(`sign-in for existing ${email} failed`);
  }

  // Granted every time, not only on creation: the role may have been granted
  // by a previous run against a database that has since been reseeded, and
  // `onConflictDoNothing` makes a second grant free.
  await grantRole(db, email, roleKey);
  accountsByRole.set(roleKey, email);
  sessionCookies.set(roleKey, await page.context().cookies());
  return email;
}
