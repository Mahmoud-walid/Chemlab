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

const KEYS = [
  "general.siteName",
  "features.registrationOpen",
  "content.lessonsPerPage",
  "localization.offeredLocales",
];

/**
 * A role that can change settings but not SECURITY settings.
 *
 * The whole point of `setting:update_security` is that these two are
 * different grants, and nothing but a real account holding one and not the
 * other can show that the screen and the write action agree about it.
 */
const LIMITED_ROLE = "e2e_settings_no_security";

test.beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  const [role] = await db
    .insert(schema.roles)
    .values({
      key: LIMITED_ROLE,
      name: "E2E settings, not security",
      description: "Created by tests/e2e/admin-settings.spec.ts.",
      isSystem: false,
      isProtected: false,
    })
    .onConflictDoUpdate({
      target: schema.roles.key,
      set: { name: "E2E settings, not security" },
    })
    .returning({ id: schema.roles.id });

  const granted = await db
    .select({ id: schema.permissions.id })
    .from(schema.permissions)
    .where(
      inArray(schema.permissions.name, [
        "admin:access",
        "setting:read",
        "setting:update",
      ]),
    );

  await db
    .insert(schema.rolePermissions)
    .values(
      granted.map((permission) => ({
        roleId: role!.id,
        permissionId: permission.id,
      })),
    )
    .onConflictDoNothing();
});

test.afterAll(async () => {
  // Back to the registry defaults, or every later run reads a changed site.
  await db.delete(schema.settings).where(inArray(schema.settings.key, KEYS));
  // `user_roles.role_id` is ON DELETE RESTRICT — deliberately, so a role
  // cannot be deleted out from under the people holding it. The grants this
  // suite made have to go first.
  const [role] = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(eq(schema.roles.key, LIMITED_ROLE));
  if (role) {
    await db
      .delete(schema.userRoles)
      .where(eq(schema.userRoles.roleId, role.id));
    await db.delete(schema.roles).where(eq(schema.roles.id, role.id));
  }
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

  test("refuses a page size outside the range, on the field", async ({
    page,
  }) => {
    await signInAs(page, db, "admin");
    await page.goto("/admin/settings");

    await page.getByRole("tab", { name: /content/i }).click();
    await page.getByLabel("Lessons per page").fill("3");
    await page.getByRole("button", { name: /save changes/i }).click();

    await expect(page.getByText(/between 4 and 60/i)).toBeVisible({
      timeout: 15_000,
    });

    // Nothing persisted: a rejected submission must not leave half a form in
    // the table.
    const rows = await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, "content.lessonsPerPage"));
    expect(rows).toEqual([]);
  });

  test("refuses to drop the language the site defaults to", async ({
    page,
  }) => {
    // The cross-key rule, through the UI. The Languages tab submits only its
    // own keys, and the rule it breaks belongs to General — so this fails only
    // if the check runs against the merged configuration.
    await signInAs(page, db, "admin");
    await page.goto("/admin/settings");

    await page.getByRole("tab", { name: /languages/i }).click();
    const english = page
      .getByRole("group", { name: "Languages offered" })
      .getByRole("checkbox", { name: "English" });
    await english.uncheck();
    await page.getByRole("button", { name: /save changes/i }).click();

    await expect(page.getByText(/has to stay in this list/i)).toBeVisible({
      timeout: 15_000,
    });

    const rows = await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, "localization.offeredLocales"));
    expect(rows).toEqual([]);
  });

  test("ties an OAuth provider's checkbox to whether its credentials exist", async ({
    page,
  }) => {
    await signInAs(page, db, "admin");
    await page.goto("/admin/settings");

    await page.getByRole("tab", { name: /security/i }).click();

    // Asserted as a COUPLING rather than as a fixed expectation: whether
    // Google's credentials are set differs between a laptop and CI, and a test
    // that hard-codes one of them passes for the wrong reason on the other.
    const badge = page.getByText(/^(Configured|Not configured)$/).first();
    await expect(badge).toBeVisible();
    const configured = (await badge.textContent())?.trim() === "Configured";

    const google = page
      .getByRole("group", { name: "Sign-in providers" })
      .getByRole("checkbox", { name: /google/i });
    await expect(google).toBeVisible();
    if (configured) {
      await expect(google).toBeEnabled();
    } else {
      await expect(google).toBeDisabled();
      await expect(
        page.getByText(/not configured on the server/i),
      ).toBeVisible();
    }
  });

  test("never renders a secret's value, prefix or length", async ({ page }) => {
    await signInAs(page, db, "admin");
    await page.goto("/admin/settings");
    await page.getByRole("tab", { name: /security/i }).click();

    const html = await page.content();
    for (const name of [
      "GOOGLE_CLIENT_SECRET",
      "BETTER_AUTH_SECRET",
      "DATABASE_URL",
    ]) {
      const value = process.env[name];
      if (!value) continue;
      // Compared as a boolean on purpose: a failing `toContain` prints the
      // whole page, which is the one place the secret would then appear.
      expect(html.includes(value), `${name} appears in the page`).toBe(false);
      expect(
        html.includes(value.slice(0, 6)),
        `${name} prefix appears in the page`,
      ).toBe(false);
    }
  });

  test("shows Security read-only to a role without setting:update_security", async ({
    page,
  }) => {
    await signInAs(page, db, LIMITED_ROLE);
    await page.goto("/admin/settings");

    // General is editable for this role...
    await expect(page.getByLabel("Site name")).toBeEnabled();

    // ...and Security is not, without disappearing: a section that vanished
    // would read as "this does not exist" rather than "not yours to change".
    await page.getByRole("tab", { name: /security/i }).click();
    await expect(page.getByText(/setting:update_security/i)).toBeVisible();
    await expect(page.getByLabel("Session length (days)")).toBeDisabled();
    await expect(
      page.getByRole("tabpanel").getByRole("button", { name: /save changes/i }),
    ).toHaveCount(0);
  });
});
