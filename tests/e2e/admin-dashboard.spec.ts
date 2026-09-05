import { expect, test } from "@playwright/test";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import { signInAs } from "./support/accounts";

/**
 * The dashboard.
 *
 * What is worth asserting through the browser is the honesty of it: that the
 * funnel says where it starts, that a stage nothing emits shows as unrecorded
 * rather than as a zero, and that every chart carries its numbers in text for
 * anyone the chart does not serve.
 */

test.describe.configure({ timeout: 90_000, mode: "serial" });

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

test.describe("the dashboard", () => {
  test("shows the charts to a reader with activity:read", async ({ page }) => {
    await signInAs(page, db, "admin");
    await page.goto("/admin");

    await expect(
      page.getByRole("heading", { name: /new accounts/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /sign-ins/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /quiz sittings/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /engagement funnel/i }),
    ).toBeVisible();
  });

  test("says where the funnel starts, and why", async ({ page }) => {
    // A funnel whose first stage we cannot measure would have an invented
    // denominator. The caveat belongs on the screen, not only in the code.
    await signInAs(page, db, "admin");
    await page.goto("/admin");

    await expect(page.getByText(/starts at REGISTERED/i)).toBeVisible();
    await expect(page.getByText(/invented denominator/i)).toBeVisible();
  });

  test("marks a stage nothing emits as unrecorded, not as zero", async ({
    page,
  }) => {
    // Nothing emits `lesson.viewed` yet — the lessons are static routes and
    // the model that would carry view tracking is #20's. "0 people read a
    // lesson" is a false claim, and the claim somebody quotes back later.
    await signInAs(page, db, "admin");
    await page.goto("/admin");

    const row = page
      .getByRole("listitem")
      .filter({ hasText: /read a lesson/i });
    await expect(row).toContainText(/not recorded yet/i);
  });

  test("puts every chart's numbers in text as well", async ({ page }) => {
    // A chart is a shape, and a shape is not readable by a screen reader.
    await signInAs(page, db, "admin");
    await page.goto("/admin");

    const readouts = page.getByText(/read the numbers instead/i);
    await expect(readouts.first()).toBeVisible();
    expect(await readouts.count()).toBeGreaterThanOrEqual(3);
  });

  test("shows a role without activity:read the sections but no charts", async ({
    page,
  }) => {
    // `editor` holds `admin:access` and so reaches the dashboard, but has no
    // business seeing what everybody did.
    await signInAs(page, db, "editor");
    await page.goto("/admin");

    await expect(
      page.getByRole("heading", { name: /dashboard/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /engagement funnel/i }),
    ).toHaveCount(0);
  });
});
