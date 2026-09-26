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

  test("an admin IS offered the New role form", async ({ page }) => {
    // Inverted deliberately. This test previously asserted the opposite,
    // because `db/seed/rbac.ts` gave Admin `role:read` and `role:assign` only
    // — so every variation the platform needed went through a Super Admin. The
    // owner asked for that to change, so Admin now holds `role:create`,
    // `role:update` and `role:delete`.
    //
    // The ceiling did NOT change, and that is what the next test checks: an
    // Admin can define a role, but only out of permissions they already hold.
    await signInAs(page, db, "admin");
    await page.goto("/en/admin/roles");
    await expect(
      page.getByRole("button", { name: /create role/i }),
    ).toBeVisible();
  });

  test("the clone picker offers system roles, which are otherwise read-only", async ({
    page,
  }) => {
    // The point of cloning: a system role's own grants cannot be edited because
    // the seed reconciles them every deploy, so the copy is the only way to get
    // "Editor, plus one more thing".
    await signInAs(page, db, "admin");
    await page.goto("/en/admin/roles");

    await page.getByRole("combobox", { name: /start from/i }).click();
    await expect(page.getByRole("option", { name: /^Editor/ })).toBeVisible();
    await expect(
      page.getByRole("option", { name: /an empty role/i }),
    ).toBeVisible();
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

test.describe("an Admin defining a role", () => {
  /** Roles this file creates, removed afterwards whatever the tests did. */
  const created: string[] = [];

  test.afterAll(async () => {
    for (const key of created) {
      const [role] = await db
        .select({ id: schema.roles.id })
        .from(schema.roles)
        .where(eq(schema.roles.key, key));
      if (!role) continue;
      await db
        .delete(schema.userRoles)
        .where(eq(schema.userRoles.roleId, role.id));
      await db.delete(schema.roles).where(eq(schema.roles.id, role.id));
    }
  });

  test("clones Editor, then narrows the copy — the original untouched", async ({
    page,
  }) => {
    await signInAs(page, db, "admin");
    await page.goto("/en/admin/roles");

    const key = `e2e_clone_w${process.env.TEST_WORKER_INDEX ?? "0"}_${Date.now()}`;
    created.push(key);

    await page.getByLabel(/^key$/i).fill(key);
    await page.getByLabel(/display name/i).fill("Cloned editor");
    await page.getByRole("combobox", { name: /start from/i }).click();
    await page.getByRole("option", { name: /^Editor/ }).click();
    await page.getByRole("button", { name: /create role/i }).click();

    // Straight to the new role, because deciding what it grants is the next
    // thing anybody wants.
    await page.waitForURL(/\/admin\/roles\/[0-9a-f-]+/);

    const [clone] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.key, key));
    expect(clone, "the clone was not written").toBeTruthy();

    const grantsOf = async (roleId: string) => {
      const rows = await db
        .select({ name: schema.permissions.name })
        .from(schema.rolePermissions)
        .innerJoin(
          schema.permissions,
          eq(schema.permissions.id, schema.rolePermissions.permissionId),
        )
        .where(eq(schema.rolePermissions.roleId, roleId));
      return rows.map((row) => row.name).sort();
    };

    const [editor] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.key, "editor"));

    const editorGrants = await grantsOf(editor!.id);
    expect(await grantsOf(clone!.id)).toEqual(editorGrants);
    expect(editorGrants.length).toBeGreaterThan(5);

    // And the copy is editable where the original is not — the whole reason
    // cloning exists.
    await expect(
      page.getByRole("button", { name: /save grants/i }),
    ).toBeVisible();

    // Targeted by the checkbox's id, not by a name regex.
    //
    // It was `getByRole("checkbox", { name: /publish/ }).first()`, and giving the
    // Admin `lesson:delete_hard` broke it in the most quiet way available: that
    // permission's DESCRIPTION reads "Erase a draft lesson that was never
    // published", so `/publish/` matched it, and within the lesson group
    // `delete_hard` sorts before `publish`. `.first()` then found a box the clone
    // does not hold, `uncheck()` on an already-unchecked box is a no-op, and the
    // grant count did not budge — a passing action with no effect.
    //
    // The id is `perm-<permission name>`, so this names exactly one permission.
    // An attribute selector rather than `#perm-lesson:publish`, because the colon
    // would need CSS escaping.
    const box = page.locator('[id="perm-lesson:publish"]');
    await expect(box).toBeChecked();
    await box.uncheck();
    await page.getByRole("button", { name: /save grants/i }).click();

    await expect
      .poll(async () => (await grantsOf(clone!.id)).length)
      .toBeLessThan(editorGrants.length);

    // The original is untouched. A clone that edited its source would be the
    // seed-revert trap wearing a different hat.
    expect(await grantsOf(editor!.id)).toEqual(editorGrants);
  });

  test("renames its own role, and is offered no rename on a system one", async ({
    page,
  }) => {
    await signInAs(page, db, "admin");
    await page.goto("/en/admin/roles");

    const key = `e2e_rename_w${process.env.TEST_WORKER_INDEX ?? "0"}_${Date.now()}`;
    created.push(key);

    await page.getByLabel(/^key$/i).fill(key);
    await page.getByLabel(/display name/i).fill("Before");
    await page.getByRole("button", { name: /create role/i }).click();
    await page.waitForURL(/\/admin\/roles\/[0-9a-f-]+/);

    await page.getByLabel(/display name/i).fill("After");
    await page.getByRole("button", { name: /save name/i }).click();

    await expect
      .poll(async () => {
        const [row] = await db
          .select({ name: schema.roles.name })
          .from(schema.roles)
          .where(eq(schema.roles.key, key));
        return row?.name;
      })
      .toBe("After");

    // A system role offers no rename at all: the database would accept it and
    // the next `pnpm db:seed` would silently put the spec's name back.
    const [editor] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.key, "editor"));
    await page.goto(`/en/admin/roles/${editor!.id}`);
    await expect(page.getByRole("button", { name: /save name/i })).toHaveCount(
      0,
    );
  });

  test("cannot clone its way past its own permissions", async ({ page }) => {
    // The ceiling. `role:create` did not become "create anything": a source
    // holding more than the Admin does is absent from the picker, and the action
    // refuses it even if the id is posted directly.
    await signInAs(page, db, "admin");

    const key = `e2e_beyond_w${process.env.TEST_WORKER_INDEX ?? "0"}_${Date.now()}`;
    created.push(key);

    // A role holding something the ADMIN does not hold, written directly — an
    // operator with a Super Admin could have made this.
    //
    // `user:impersonate`, not `lesson:delete_hard` as it was: the Admin holds
    // that one now. It holds 49 of the 53 permissions, so the ceiling is only the
    // four nothing implements — thin, but the rule has to keep holding at
    // whatever the boundary is, and this is where it is proven from a browser.
    const [beyondAdmin] = await db
      .select({ id: schema.permissions.id })
      .from(schema.permissions)
      .where(eq(schema.permissions.name, "user:impersonate"));
    expect(beyondAdmin, "the catalogue has no user:impersonate").toBeTruthy();
    const beyondId = crypto.randomUUID();
    await db.insert(schema.roles).values({
      id: beyondId,
      key,
      name: "Beyond an Admin",
      isSystem: false,
      isProtected: false,
    });
    await db
      .insert(schema.rolePermissions)
      .values({ roleId: beyondId, permissionId: beyondAdmin!.id });

    await page.goto("/en/admin/roles");
    await page.getByRole("combobox", { name: /start from/i }).click();
    await expect(
      page.getByRole("option", { name: /beyond an admin/i }),
    ).toHaveCount(0);
  });
});
