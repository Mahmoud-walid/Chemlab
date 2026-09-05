import { expect, type Page } from "@playwright/test";
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

/**
 * Signs up, retrying while the rate limiter says no.
 *
 * The 429 is the product working. Backing off is what a real client would do,
 * and it keeps the suite honest about the limit existing.
 */
export async function signUpViaApi(page: Page, email: string): Promise<void> {
  let lastStatus = 0;

  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await page.request.post("/api/auth/sign-up/email", {
      data: { email, password: TEST_PASSWORD, name: "E2E Probe" },
      headers: {
        Origin: new URL(page.url() || "http://localhost:3000").origin,
      },
    });
    lastStatus = response.status();
    if (response.ok()) return;
    if (lastStatus !== 429) break;
    await sleep(1_500 * (attempt + 1));
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

/** Signs up and grants a role, leaving the page signed in. */
export async function signInAs(
  page: Page,
  db: SeedDatabase,
  roleKey: string,
): Promise<string> {
  // A page needs an origin before `page.request` can resolve a relative URL.
  await page.goto("/");
  const email = uniqueEmail(roleKey);
  await signUpViaApi(page, email);
  await grantRole(db, email, roleKey);
  return email;
}
