import { expect, test } from "@playwright/test";

/**
 * The account journey in a real browser: sign up, land signed in, survive a
 * reload, edit the profile, sign out.
 *
 * This is the layer that proves the parts the integration suite cannot — that
 * the cookie the server sets is one the browser keeps and sends back, that the
 * header reflects the session on first paint, and that the protected routes
 * bounce an anonymous visitor and return them afterwards.
 */

const PASSWORD = "correct-horse-battery";

/** A fresh address per test, so runs do not collide on the unique email. */
function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function signUp(page: import("@playwright/test").Page, email: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Ada Lovelace");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
}

test.describe("accounts", () => {
  test("sign up, stay signed in across a reload, then sign out", async ({
    page,
  }) => {
    const email = uniqueEmail();
    await signUp(page, email);

    // The header swaps to the avatar menu once the session exists.
    const accountMenu = page.getByRole("button", {
      name: /open the account menu/i,
    });
    await expect(accountMenu).toBeVisible({ timeout: 15_000 });

    // A session that does not survive a reload is a session in memory.
    await page.reload();
    await expect(accountMenu).toBeVisible();

    await accountMenu.click();
    await expect(page.getByText(email)).toBeVisible();
    await page
      .getByRole("menuitem", { name: /profile/i })
      .first()
      .click();

    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByLabel(/display name/i)).toHaveValue("Ada Lovelace");

    await accountMenu.click();
    await page.getByRole("menuitem", { name: /sign out/i }).click();

    await expect(
      page.getByRole("link", { name: "Sign in", exact: true }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("an anonymous visitor is sent to sign in and returned afterwards", async ({
    page,
  }) => {
    await page.goto("/profile/exams");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fprofile%2Fexams/);

    const email = uniqueEmail();
    // Sign up from here — the `next` parameter must survive the switch to the
    // sign-up page and bring the new user back to where they were going.
    // Scoped to <main>: the header carries its own "Sign up" for anonymous
    // visitors, so an unscoped selector matches two links.
    await page
      .getByRole("main")
      .getByRole("link", { name: "Sign up", exact: true })
      .click();
    await page.getByLabel("Name").fill("Grace Hopper");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up", exact: true }).click();

    await expect(page).toHaveURL(/\/profile\/exams$/, { timeout: 15_000 });
  });

  test("a hostile next parameter cannot redirect off-origin", async ({
    page,
  }) => {
    await page.goto("/sign-in?next=https%3A%2F%2Fevil.example");

    const email = uniqueEmail();
    // Scoped to <main>: the header carries its own "Sign up" for anonymous
    // visitors, so an unscoped selector matches two links.
    await page
      .getByRole("main")
      .getByRole("link", { name: "Sign up", exact: true })
      .click();
    await page.getByLabel("Name").fill("Ada Lovelace");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up", exact: true }).click();

    await expect(
      page.getByRole("button", { name: /open the account menu/i }),
    ).toBeVisible({ timeout: 15_000 });
    // Landed on our own origin, not the attacker's: the hostile `next`
    // collapsed to "/" rather than being followed.
    await expect(page).not.toHaveURL(/evil\.example/);
    await expect(page).toHaveURL(/localhost:\d+\/?$/);
  });

  test("editing the profile persists", async ({ page }) => {
    await signUp(page, uniqueEmail());
    await expect(
      page.getByRole("button", { name: /open the account menu/i }),
    ).toBeVisible({ timeout: 15_000 });

    await page.goto("/profile");
    await page.getByLabel(/display name/i).fill("Ada L.");
    await page.getByLabel(/about you/i).fill("Chemistry teacher.");
    await page.getByRole("button", { name: /save changes/i }).click();

    // Wait for the confirmation rather than reloading straight away: the save
    // is a server action, and reloading mid-flight reads the old row.
    await expect(page.getByText(/your profile is saved/i).first()).toBeVisible({
      timeout: 15_000,
    });

    await page.reload();
    await expect(page.getByLabel(/display name/i)).toHaveValue("Ada L.");
    await expect(page.getByLabel(/about you/i)).toHaveValue(
      "Chemistry teacher.",
    );
  });
});
