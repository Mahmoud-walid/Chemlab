import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { signInAs } from "./support/accounts";

/**
 * The page open/close switch, in a real browser.
 *
 * Proves what the integration suite cannot: that the proxy actually serves the
 * maintenance page instead of the real one, that a bypass holder still sees
 * the page with a banner, and that a closed route disappears from the nav.
 */

/**
 * Serial, and with a long budget.
 *
 * Serial because these share one row in a seven-row table: a parallel test that
 * reopened the route mid-assertion would fail for a reason that has nothing to
 * do with what it is testing. The budget is long because each state change
 * waits out the proxy's cache TTL.
 *
 * One call, not two — a second `configure` at file scope replaces the first,
 * and losing the timeout here would fail every test at the default 30s.
 */
test.describe.configure({ timeout: 90_000, mode: "serial" });

/** The proxy caches the open/closed map; a change is only certain after this. */
const CACHE_TTL_MS = 15_000;

let db: SeedDatabase;
let close: () => Promise<void>;

/**
 * `/games` is the route these tests close: it is a placeholder page, so
 * closing it briefly cannot break another spec's journey the way closing
 * `/quiz` or `/lessons` would.
 */
const ROUTE = "/games";

test.beforeAll(() => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));
});

test.afterAll(async () => {
  await openRoute();
  await close?.();
});

async function closeRoute() {
  await db
    .update(schema.pages)
    .set({ isEnabled: false, disabledAt: new Date() })
    .where(eq(schema.pages.routeKey, ROUTE));
  // The running server holds its own cached map, so waiting out the TTL is the
  // only honest way to observe the change from outside the process.
  await new Promise((resolve) => setTimeout(resolve, CACHE_TTL_MS + 1_000));
}

async function openRoute() {
  await db
    .update(schema.pages)
    .set({ isEnabled: true, disabledAt: null, disabledBy: null })
    .where(eq(schema.pages.routeKey, ROUTE));
  await new Promise((resolve) => setTimeout(resolve, CACHE_TTL_MS + 1_000));
}

test.describe("the page switch", () => {
  test("closes a page for visitors and reopens it without a deploy", async ({
    page,
  }) => {
    await page.goto(ROUTE);
    await expect(
      page.getByRole("heading", { name: /this page is closed/i }),
    ).toHaveCount(0);

    await closeRoute();

    await page.goto(ROUTE);
    await expect(
      page.getByRole("heading", { name: /this page is closed/i }),
    ).toBeVisible();
    // A rewrite, not a redirect: the URL is still the page they asked for, so
    // a reload lands on it the moment it reopens.
    await expect(page).toHaveURL(new RegExp(`${ROUTE}$`));

    await openRoute();

    await page.goto(ROUTE);
    await expect(
      page.getByRole("heading", { name: /this page is closed/i }),
    ).toHaveCount(0);
  });

  test("removes a closed page from the navigation", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /games/i })).toBeVisible();

    await closeRoute();

    await page.goto("/");
    await expect(page.getByRole("link", { name: /games/i })).toHaveCount(0);
    // The rest of the nav is untouched.
    await expect(
      page.getByRole("link", { name: /quiz/i }).first(),
    ).toBeVisible();

    await openRoute();
  });

  test("lets a bypass holder through, with a banner saying so", async ({
    page,
  }) => {
    // `admin` holds page:bypass; `editor` does not.
    await signInAs(page, db, "admin");
    await closeRoute();

    await page.goto(ROUTE);
    await expect(
      page.getByRole("heading", { name: /this page is closed/i }),
    ).toHaveCount(0);
    // Without the banner the bypass is a trap: the page looks normal, so a fix
    // gets reported as working while visitors still cannot reach it.
    await expect(page.getByText(/closed to visitors/i)).toBeVisible();

    await openRoute();
  });

  test("does not let a signed-in user without the permission through", async ({
    page,
  }) => {
    await signInAs(page, db, "editor");
    await closeRoute();

    await page.goto(ROUTE);
    await expect(
      page.getByRole("heading", { name: /this page is closed/i }),
    ).toBeVisible();

    await openRoute();
  });

  test("shows the switches to an operator", async ({ page }) => {
    await signInAs(page, db, "admin");
    await page.goto("/admin/pages");

    await expect(page.getByRole("heading", { name: "Pages" })).toBeVisible();
    await expect(page.getByLabel(/close games/i)).toBeVisible();
    // The routes with no switch are explained on the screen rather than simply
    // absent, so an operator looking for one learns why instead of assuming a
    // bug.
    await expect(page.getByText(/have no switch on purpose/i)).toBeVisible();
  });

  test("shows a role without page permissions nothing of the section", async ({
    page,
  }) => {
    // `editor` publishes content but holds no `page:*` permission at all.
    await signInAs(page, db, "editor");
    await page.goto("/admin/pages");

    // Asserted on the CONTENT, not the status — see the note in the admin
    // layout and Q31.
    await expect(
      page.getByRole("heading", { name: /not found/i }),
    ).toBeVisible();

    // Asserted on DATA, not on a UI string. The admin layout serialises the
    // whole admin message catalogue for anyone holding `admin:access`, so
    // grepping the HTML for a label finds the catalogue and fails for a reason
    // that has nothing to do with the guard. Route keys only appear if the
    // table actually rendered.
    const html = await page.content();
    expect(html).not.toContain("/quiz/results");
    expect(html).not.toContain("/chemical");
    await expect(page.getByLabel(/close games/i)).toHaveCount(0);
  });
});
