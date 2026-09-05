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

test.describe.configure({ timeout: 90_000 });

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

// Serial: these share one row in a seven-row table, and a parallel test that
// reopened the route mid-assertion would fail for the wrong reason.
test.describe.configure({ mode: "serial" });

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

  test("shows the switches to an operator and refuses them to an editor", async ({
    page,
  }) => {
    await signInAs(page, db, "admin");
    await page.goto("/admin/pages");

    await expect(page.getByRole("heading", { name: "Pages" })).toBeVisible();
    await expect(page.getByLabel(/close games/i)).toBeVisible();
    // The routes with no switch are explained on the screen rather than simply
    // absent.
    await expect(page.getByText(/have no switch on purpose/i)).toBeVisible();
  });
});
