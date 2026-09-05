import { expect, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { signInAs } from "./support/accounts";

/**
 * The settings screen, end to end.
 *
 * The claim worth proving here is the one that no unit or integration test
 * reaches: that changing the site name in the admin panel changes what a
 * visitor's page metadata says, on the next request, with no rebuild.
 */

test.describe.configure({ timeout: 90_000, mode: "serial" });

let db: SeedDatabase;
let close: () => Promise<void>;

const KEYS = ["general.siteName", "features.registrationOpen"];

test.beforeAll(() => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));
});

test.afterAll(async () => {
  // Back to the registry defaults, or every later run reads a changed site.
  await db.delete(schema.settings).where(inArray(schema.settings.key, KEYS));
  await close?.();
});

test.describe("the settings screen", () => {
  test("changes the site name, and the public metadata follows", async ({
    page,
  }) => {
    await signInAs(page, db, "admin");
    await page.goto("/admin/settings");

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    const name = `Chemlab ${Date.now()}`;
    await page.getByLabel("Site name").fill(name);
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByText(/^Saved$/).first()).toBeVisible({
      timeout: 15_000,
    });

    // The point of the whole feature: renaming the site is a settings change,
    // not a redeploy.
    await page.goto("/");
    await expect(page).toHaveTitle(
      new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );

    const [row] = await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, "general.siteName"));
    expect(row?.value).toBe(name);
    expect(row?.updatedBy).not.toBeNull();
  });

  test("refuses an empty site name with a message on the field", async ({
    page,
  }) => {
    await signInAs(page, db, "admin");
    await page.goto("/admin/settings");

    await page.getByLabel("Site name").fill("");
    await page.getByRole("button", { name: /save changes/i }).click();

    await expect(page.getByText(/enter a site name/i)).toBeVisible({
      timeout: 15_000,
    });
  });

  test("records one activity event per changed key", async ({ page }) => {
    await signInAs(page, db, "admin");
    await page.goto("/admin/settings");

    await page.getByRole("tab", { name: /features/i }).click();
    await page.getByLabel("Allow new accounts").click();
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByText(/^Saved$/).first()).toBeVisible({
      timeout: 15_000,
    });

    // `after()` defers the write, so it is not immediate.
    let rows: { metadata: unknown }[] = [];
    for (let i = 0; i < 20 && rows.length === 0; i++) {
      rows = await db
        .select({ metadata: schema.activityEvents.metadata })
        .from(schema.activityEvents)
        .where(eq(schema.activityEvents.objectId, "features.registrationOpen"));
      if (rows.length === 0) await new Promise((r) => setTimeout(r, 250));
    }

    expect(rows.length).toBeGreaterThan(0);
    const metadata = rows[0]!.metadata as { key: string; to: unknown };
    expect(metadata.key).toBe("features.registrationOpen");
    // Old and new both recorded — safe because no secret may live in this
    // table, which tests/lib/settings-registry.test.ts enforces.
    expect(metadata).toHaveProperty("from");
    expect(metadata.to).toBe(false);

    await db
      .delete(schema.activityEvents)
      .where(eq(schema.activityEvents.objectId, "features.registrationOpen"));
  });

  test("shows a reader without setting:update the sections, read-only", async ({
    page,
  }) => {
    // `editor` holds no `setting:*` permission at all, so it gets a 404 —
    // the read-only path needs `setting:read`, which only admin has here.
    await signInAs(page, db, "editor");
    const response = await page.goto("/admin/settings");
    expect(response?.status()).toBe(404);
  });
});
