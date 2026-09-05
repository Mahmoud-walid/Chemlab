import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";

/**
 * The admin gate, in a real browser.
 *
 * The unit tests prove the filtering function; these prove that what actually
 * reaches the wire matches it — that an unauthorised request gets no admin
 * markup at all, and that a narrow role's sidebar contains only the links it
 * may use.
 */

const PASSWORD = "correct-horse-battery";

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

function uniqueEmail(role: string): string {
  return `e2e-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@admin-e2e.invalid`;
}

async function signUp(page: Page, email: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Admin Probe");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /open the account menu/i }),
  ).toBeVisible({ timeout: 15_000 });
}

/** Grants a role directly: the admin UI for doing so is a later issue. */
async function grantRole(email: string, roleKey: string) {
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email));
  const [role] = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(eq(schema.roles.key, roleKey));

  await db
    .insert(schema.userRoles)
    .values({ userId: user!.id, roleId: role!.id })
    .onConflictDoNothing();
}

test.describe("the admin gate", () => {
  test("sends an anonymous visitor to sign in, keeping the locale", async ({
    page,
  }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fadmin/);

    await page.goto("/ar/admin");
    // The Arabic visitor must not land on the English sign-in page.
    await expect(page).toHaveURL(/\/ar\/sign-in\?next=%2Far%2Fadmin/);
  });

  test("gives a signed-in user without admin:access a 404 with no admin markup", async ({
    page,
  }) => {
    await signUp(page, uniqueEmail("member"));

    const response = await page.goto("/admin");
    // 404, not 403: a 403 confirms /admin exists and is worth attacking.
    expect(response?.status()).toBe(404);

    const html = await page.content();
    // Not one nav label, not one admin link — the panel's shape is not
    // advertised to someone who cannot open it.
    for (const label of [
      "Admin navigation",
      "Roles and permissions",
      "Chemlab admin",
    ]) {
      expect(html, label).not.toContain(label);
    }
    expect(html).not.toContain('href="/admin/settings"');
  });

  test("shows a narrow role only the sections it holds", async ({ page }) => {
    const email = uniqueEmail("editor");
    await signUp(page, email);
    await grantRole(email, "editor");

    await page.goto("/admin");
    await expect(
      page.getByRole("heading", { name: /dashboard/i }).first(),
    ).toBeVisible();

    const nav = page.getByRole("navigation", { name: /admin navigation/i });
    await expect(nav.getByRole("link", { name: /elements/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /lessons/i })).toBeVisible();

    // The editor holds none of these.
    for (const hidden of [
      /settings/i,
      /users/i,
      /roles and permissions/i,
      /activity/i,
    ]) {
      await expect(nav.getByRole("link", { name: hidden })).toHaveCount(0);
    }
  });

  test("shows a Super Admin every section", async ({ page }) => {
    const email = uniqueEmail("super");
    await signUp(page, email);
    await grantRole(email, "super_admin");

    await page.goto("/admin");
    const nav = page.getByRole("navigation", { name: /admin navigation/i });
    for (const label of [
      /elements/i,
      /lessons/i,
      /users/i,
      /roles and permissions/i,
      /settings/i,
      /activity/i,
    ]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
  });

  test("is operable by keyboard, and the sidebar toggle is reachable", async ({
    page,
  }) => {
    const email = uniqueEmail("kbd");
    await signUp(page, email);
    await grantRole(email, "editor");
    await page.goto("/admin");

    const toggle = page.getByRole("button", { name: /toggle the sidebar/i });
    await expect(toggle).toBeVisible();

    // Tab until the toggle takes focus. A control nobody can reach by keyboard
    // is a control some people do not have.
    let reached = false;
    for (let i = 0; i < 30 && !reached; i++) {
      await page.keyboard.press("Tab");
      reached = await toggle.evaluate((el) => el === document.activeElement);
    }
    expect(reached, "the sidebar toggle should be reachable by Tab").toBe(true);

    await page.keyboard.press("Enter");
    // Collapsing and expanding must both work from the keyboard.
    await expect(toggle).toBeFocused();
  });
});
