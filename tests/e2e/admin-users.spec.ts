import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { signInAs, signUpViaApi, uniqueEmail } from "./support/accounts";

/**
 * The people section.
 *
 * The sidebar has linked here since the admin shell shipped and the route did
 * not exist, so the first thing worth asserting is that the link now goes
 * somewhere. The rest is the per-user record #19 exists for: what did this
 * person do, and what did they score.
 */

test.describe.configure({ timeout: 120_000, mode: "serial" });

let db: SeedDatabase;
let close: () => Promise<void>;

/** A candidate with a real sitting behind them, created once for the suite. */
let subjectEmail: string;

test.beforeAll(() => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));
});

test.afterAll(async () => {
  await close?.();
});

test.describe("users", () => {
  test("is reachable from the sidebar and lists accounts", async ({ page }) => {
    await signInAs(page, db, "admin");
    await page.goto("/admin");

    await page
      .getByRole("link", { name: /^users$/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/admin\/users/);
    await expect(page.getByRole("heading", { name: /^users$/i })).toBeVisible();
  });

  test("finds one person by email and opens their record", async ({ page }) => {
    // A fresh candidate who actually sits a quiz, so the record has content.
    await page.goto("/");
    subjectEmail = uniqueEmail("people");
    await signUpViaApi(page, subjectEmail);
    await page.goto("/quiz/periodic-table-basics");
    await page.getByRole("button", { name: /start quiz/i }).click();
    await page.waitForURL(/\/quiz\/.+\/attempt/);
    for (let i = 0; i < 10; i++) {
      await page.getByTestId("quiz-option").first().click();
      const next = page.getByRole("button", { name: /^next question$/i });
      if (await next.isVisible()) await next.click();
    }
    await page.getByRole("button", { name: /submit answers/i }).click();
    await page.waitForURL(/\/attempts\//);

    await signInAs(page, db, "admin");
    await page.goto("/admin/users");
    await page.getByLabel(/search people/i).fill(subjectEmail);
    await page.getByLabel(/search people/i).press("Enter");

    await expect(page.getByText(subjectEmail)).toBeVisible();
    await page
      .getByRole("link", { name: /e2e probe/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/admin\/users\/.+/);
  });

  test("shows their exam record and their activity", async ({ page }) => {
    await signInAs(page, db, "admin");

    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, subjectEmail));

    await page.goto(`/admin/users/${user!.id}`);

    await expect(
      page.getByRole("heading", { name: /exam record/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /periodic table/i }),
    ).toBeVisible();
    // Best AND latest, because one number hides either the improvement or the
    // regression.
    await expect(page.getByText(/^Best$/)).toBeVisible();
    await expect(page.getByText(/^Latest$/)).toBeVisible();

    await expect(
      page.getByRole("heading", { name: /^activity$/i }),
    ).toBeVisible();
    await expect(page.getByText(/signed up/i).first()).toBeVisible();
  });

  test("does not put personal data in the timeline", async ({ page }) => {
    // The timeline is shown to any reader with `activity:read`. IP address
    // and user agent need `activity:read_pii` and are served elsewhere.
    await signInAs(page, db, "admin");
    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, subjectEmail));

    await page.goto(`/admin/users/${user!.id}`);
    const html = await page.content();
    expect(html.includes("ipAddress")).toBe(false);
    expect(html.includes("userAgent")).toBe(false);
  });

  test("shows the not-found page for an unknown account", async ({ page }) => {
    await signInAs(page, db, "admin");
    await page.goto("/admin/users/no-such-account");

    // Asserted on what renders, not on the status. `notFound()` from a page
    // cannot set 404 here: these routes are `force-dynamic` and stream, so the
    // 200 header is already on the wire by the time the page decides. The
    // LAYOUT's `notFound()` still returns 404 — it runs before streaming
    // begins — which is why the permission tests below can assert a status
    // and this one cannot. Every admin detail page behaves this way; it is
    // not particular to this one.
    await expect(
      page.getByRole("heading", { name: /not found/i }),
    ).toBeVisible();
    await expect(page.getByText(/nothing at that address/i)).toBeVisible();
  });

  test("shows a role without user:read nothing of the section", async ({
    page,
  }) => {
    await signInAs(page, db, "editor");
    const response = await page.goto("/admin/users");
    expect(response?.status()).toBe(404);

    await page.goto("/admin");
    await expect(page.getByRole("link", { name: /^users$/i })).toHaveCount(0);
  });
});
