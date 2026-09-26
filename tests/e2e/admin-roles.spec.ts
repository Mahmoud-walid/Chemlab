import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { signInAs, signUpViaApi, uniqueEmail } from "./support/accounts";

/**
 * Roles and permissions, through the browser.
 *
 * Two things only this layer can prove. The first is the STATUS an
 * under-privileged reader gets — 404, not 403, and not a 200 with an error
 * page, which is what an uncaught `requirePermission` would render. The second
 * is that the escalation rule reaches the UI: a role an Admin may not grant
 * must not be offered to them, because a picker that offers it and an action
 * that refuses it is a screen that lies.
 *
 * Every navigation carries an explicit `/en`. `localePrefix` is `as-needed`, so
 * next-intl remembers the last locale in a cookie — and a spec that ran after
 * an Arabic one would assert English names against an Arabic panel, where every
 * name misses and `toHaveCount(0)` is trivially true.
 */

test.describe.configure({ timeout: 90_000 });

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

test.describe("who can reach the roles screen", () => {
  test("a signed-in member gets 404, not 403 and not an error page", async ({
    page,
  }) => {
    await signInAs(page, db, "member");
    const response = await page.goto("/en/admin/roles");
    // Asserted on the STATUS, not the body: a 403 confirms the page exists and
    // is worth attacking, and a 200 carrying "something went wrong" says the
    // request succeeded when it was refused.
    expect(response?.status()).toBe(404);
  });

  test("a moderator gets 404 too — comment work is not role work", async ({
    page,
  }) => {
    await signInAs(page, db, "moderator");
    const response = await page.goto("/en/admin/roles");
    expect(response?.status()).toBe(404);
  });

  test("an admin sees every role", async ({ page }) => {
    await signInAs(page, db, "admin");
    await page.goto("/en/admin/roles");

    await expect(
      page.getByRole("heading", { name: /roles and permissions/i }),
    ).toBeVisible();

    for (const key of [
      "super_admin",
      "admin",
      "editor",
      "moderator",
      "member",
    ]) {
      await expect(page.getByText(key, { exact: true })).toBeVisible();
    }
  });
});

test.describe("what the roles screen says about a role", () => {
  test("Super Admin is shown as implicit, with no checkbox list", async ({
    page,
  }) => {
    await signInAs(page, db, "admin");

    const [role] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.key, "super_admin"));

    await page.goto(`/en/admin/roles/${role!.id}`);

    await expect(page.getByText(/everything, implicitly/i)).toBeVisible();
    // The absence is the assertion. Rendering 53 ticked boxes would suggest the
    // power comes from those rows and that unticking one would remove it.
    await expect(page.getByRole("checkbox")).toHaveCount(0);
  });

  test("a system role says its grants come from the seed, and offers no save", async ({
    page,
  }) => {
    await signInAs(page, db, "admin");

    const [role] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.key, "editor"));

    await page.goto(`/en/admin/roles/${role!.id}`);

    await expect(page.getByText(/db\/seed\/rbac\.ts/)).toBeVisible();
    // Absent, not disabled: an edit here would appear to work and then revert
    // on the next deploy, which is worse than no control at all.
    await expect(
      page.getByRole("button", { name: /save grants/i }),
    ).toHaveCount(0);
    // The grants are still shown — read-only is not hidden.
    await expect(
      page.getByText("lesson:publish", { exact: true }),
    ).toBeVisible();
  });

  test("an admin is offered no delete button on a protected role", async ({
    page,
  }) => {
    await signInAs(page, db, "admin");
    const [role] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.key, "super_admin"));

    await page.goto(`/en/admin/roles/${role!.id}`);
    await expect(
      page.getByRole("button", { name: /delete role/i }),
    ).toHaveCount(0);
  });

  test("an admin is offered no New role form — that needs role:create", async ({
    page,
  }) => {
    // `db/seed/rbac.ts` gives Admin `role:read` and `role:assign` only, so an
    // Admin can staff the roles that exist without being able to invent one.
    await signInAs(page, db, "admin");
    await page.goto("/en/admin/roles");
    await expect(
      page.getByRole("button", { name: /create role/i }),
    ).toHaveCount(0);
  });
});

test.describe("granting and revoking on a user", () => {
  test("an admin grants a role, then revokes it", async ({ page }) => {
    await signInAs(page, db, "admin");

    // A fresh account to act on, so this test never demotes one another spec
    // is signed in as.
    const email = uniqueEmail("role-target");
    await signUpViaApi(page, email);
    const [target] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email));

    // Signing up switched the browser's session to the new account; back to the
    // admin before touching the panel.
    await signInAs(page, db, "admin");
    await page.goto(`/en/admin/users/${target!.id}`);

    await expect(page.getByRole("heading", { name: /^roles$/i })).toBeVisible();

    await page.getByRole("combobox", { name: /grant a role/i }).click();
    await page.getByRole("option", { name: "Editor" }).click();
    await page.getByRole("button", { name: /grant a role/i }).click();

    // The chip appears, and the database agrees — a UI that shows the grant
    // without writing it is the failure worth catching here.
    await expect(page.getByText("editor", { exact: true })).toBeVisible();
    await expect
      .poll(async () => {
        const rows = await db
          .select({ key: schema.roles.key })
          .from(schema.userRoles)
          .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
          .where(eq(schema.userRoles.userId, target!.id));
        return rows.map((row) => row.key).sort();
      })
      .toContain("editor");

    await page.getByRole("button", { name: /revoke editor/i }).click();

    await expect
      .poll(async () => {
        const rows = await db
          .select({ key: schema.roles.key })
          .from(schema.userRoles)
          .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
          .where(eq(schema.userRoles.userId, target!.id));
        return rows.map((row) => row.key);
      })
      .not.toContain("editor");
  });

  test("super_admin is not offered to an admin", async ({ page }) => {
    // The escalation rule, in the UI. An Admin holds `role:assign`; the picker
    // must not offer what the action would refuse, or the screen lies.
    await signInAs(page, db, "admin");

    const email = uniqueEmail("no-escalation");
    await signUpViaApi(page, email);
    const [target] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email));

    await signInAs(page, db, "admin");
    await page.goto(`/en/admin/users/${target!.id}`);

    await page.getByRole("combobox", { name: /grant a role/i }).click();
    await expect(page.getByRole("option", { name: "Editor" })).toBeVisible();
    await expect(
      page.getByRole("option", { name: /super admin/i }),
    ).toHaveCount(0);
  });

  test("an admin cannot revoke their own last privileged role", async ({
    page,
  }) => {
    // The footgun this guards: the only way back is a shell on the database.
    const email = await signInAs(page, db, "admin");
    const [self] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email));

    await page.goto(`/en/admin/users/${self!.id}`);
    await page.getByRole("button", { name: /revoke admin/i }).click();

    // `.first()`: sonner renders the toast twice — once visibly and once in an
    // aria-live region for screen readers — so a strict locator matches two
    // nodes. Both are the message; either one being present is the assertion.
    await expect(
      page.getByText(/remove your own ability to change roles/i).first(),
    ).toBeVisible();

    // And it really is still there.
    await expect
      .poll(async () => {
        const rows = await db
          .select({ key: schema.roles.key })
          .from(schema.userRoles)
          .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
          .where(eq(schema.userRoles.userId, self!.id));
        return rows.map((row) => row.key);
      })
      .toContain("admin");
  });
});
