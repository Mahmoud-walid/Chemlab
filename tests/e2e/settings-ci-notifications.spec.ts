import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { signInAs } from "./support/accounts";

/**
 * The Development section of the settings page.
 *
 * The claim worth a browser: the section is ABSENT for somebody who does not
 * hold `notification:subscribe_ci`, and present for somebody who does. Branch
 * names, commit messages and CI failure detail on the settings page of a site
 * aimed at children is the failure this gate exists to prevent, and "the server
 * would refuse the API" is not an answer to a section that renders.
 *
 * The Admin holds the permission now (`db/seed/rbac.ts`, at the owner's
 * decision), so the absence tests are asked of an EDITOR — privileged enough
 * that they cannot pass by the account being powerless.
 */

/**
 * Serial, and not because of speed.
 *
 * It was the shared GRANT that forced this: the tests granted the permission to
 * the `admin` role for their duration while another asserted the section was
 * absent without it, and `fullyParallel` splits one file across workers.
 *
 * The grant is gone — the Admin holds it from `db/seed/rbac.ts` — but serial
 * stays, for a reason that has not gone anywhere: two of these tests write and
 * read `ci_notification_preferences` for the SAME shared admin account, so in
 * parallel one can save while the other reads. The hard-delete specs dropped
 * serial in this change because they had no such row; this one keeps it.
 */
test.describe.configure({ mode: "serial", timeout: 120_000 });

let db: SeedDatabase;
let close: () => Promise<void>;

test.beforeAll(() => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));
});

test.afterAll(async () => {
  // The opt-in row this file writes, taken back. The account is shared with
  // every other admin spec in the suite, and leaving it subscribed to build
  // alerts would make `optedInRecipients` return it in whatever runs next.
  if (adminUserId) {
    await db
      .delete(schema.ciNotificationPreferences)
      .where(eq(schema.ciNotificationPreferences.userId, adminUserId));
  }
  await close?.();
});

/** The shared admin account's id, learned the first time it signs in. */
let adminUserId: string | undefined;

async function signInAsAdmin(page: import("@playwright/test").Page) {
  const email = await signInAs(page, db, "admin");
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email));
  adminUserId = user!.id;
  return adminUserId;
}

/**
 * Runs `run` with `notification:subscribe_ci` confirmed on the role.
 *
 * It used to GRANT the permission and take it back afterwards, because no role
 * held it. The Admin holds it from `db/seed/rbac.ts` now, so this asserts the
 * seed instead of mutating the role — and the change of direction matters: a
 * grant-and-revoke here would strip a SEEDED permission halfway through the run
 * and leave every later test failing for a reason nothing states.
 *
 * Kept as a wrapper rather than deleted, so the assertion sits exactly where the
 * old grant did: if `pnpm db:seed` ever stops granting this, these tests say so
 * in one line instead of failing on a missing button.
 */
async function withPermission(roleKey: string, run: () => Promise<void>) {
  const [row] = await db
    .select({ roleId: schema.rolePermissions.roleId })
    .from(schema.rolePermissions)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.rolePermissions.roleId))
    .innerJoin(
      schema.permissions,
      eq(schema.permissions.id, schema.rolePermissions.permissionId),
    )
    .where(
      and(
        eq(schema.roles.key, roleKey),
        eq(schema.permissions.name, "notification:subscribe_ci"),
      ),
    );

  expect(
    row,
    `${roleKey} does not hold notification:subscribe_ci — run pnpm db:seed`,
  ).toBeTruthy();

  await run();
}

const heading = (page: import("@playwright/test").Page) =>
  page.getByRole("heading", { name: "Development", exact: true });

test.describe("CI alerts in settings", () => {
  test("are absent for an editor, which holds no CI subscription", async ({
    page,
  }) => {
    // Re-pointed from `admin` to `editor`, because the Admin now holds
    // `notification:subscribe_ci` from the seed. The guard is unchanged and is
    // the whole reason this file exists: branch names, commit messages and CI
    // failure detail on the settings page of a site aimed at children. Editor is
    // the sharper subject than a plain member — it holds `admin:access`, so this
    // cannot pass merely by the account being powerless.
    await signInAs(page, db, "editor");
    await page.goto("/en/profile/settings");

    // The rest of the page is there, so an empty assertion cannot pass by the
    // page having failed to load.
    await expect(
      page.getByRole("heading", { name: "What you are notified about" }),
    ).toBeVisible();
    await expect(heading(page)).toHaveCount(0);
  });

  test("the API says nothing either, without the permission", async ({
    page,
  }) => {
    await signInAs(page, db, "editor");

    // 404 rather than 403: somebody who does not work on this repository has
    // no business learning that it notifies anybody about its builds.
    const read = await page.request.get("/api/ci/preferences");
    expect(read.status()).toBe(404);

    const write = await page.request.patch("/api/ci/preferences", {
      data: { enabled: true },
    });
    expect(write.status()).toBe(404);
  });

  test("appear once the permission is granted, and save", async ({ page }) => {
    await withPermission("admin", async () => {
      const userId = await signInAsAdmin(page);
      await page.goto("/en/profile/settings");

      await expect(heading(page)).toBeVisible();

      // Off until asked for. An absent row means no CI notifications, ever.
      const enabled = page.getByLabel("Tell me about builds");
      await expect(enabled).toBeVisible();
      await expect(enabled).not.toBeChecked();

      await enabled.click();
      // `.first()`: sonner renders the toast twice, once visibly and once in
      // an aria-live mirror for screen readers.
      await expect(page.getByText("Saved.").first()).toBeVisible({
        timeout: 15_000,
      });

      // The default watch list, which is `main` alone because a red `main` is
      // the emergency and everything else is opt-in on top of it.
      await expect(page.getByLabel("Branches to watch")).toHaveValue("main");

      // And it is really in the table, for THIS account — the switch
      // reporting success while nothing was written is the exact failure the
      // optimistic flip could hide, and a query across every row would be
      // satisfied by somebody else's.
      const [row] = await db
        .select({ enabled: schema.ciNotificationPreferences.enabled })
        .from(schema.ciNotificationPreferences)
        .where(eq(schema.ciNotificationPreferences.userId, userId));
      expect(row?.enabled).toBe(true);
    });
  });

  test("refuse a branch pattern that would match nothing", async ({ page }) => {
    await withPermission("admin", async () => {
      await signInAsAdmin(page);
      await page.goto("/en/profile/settings");

      const branches = page.getByLabel("Branches to watch");
      await expect(branches).toBeVisible();
      // `feat*` without the slash parses as a branch name, matches nothing,
      // and would leave somebody believing they watch a branch they do not.
      await branches.fill("feat*");

      // By its text rather than by `role=alert`: Next's own route announcer
      // is also `role="alert"` and is empty between navigations, so a
      // positional alert locator can land on it.
      await expect(page.getByText(/Watch at least one branch/)).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Save", exact: true }),
      ).toBeDisabled();

      // And it becomes saveable the moment the pattern is one the policy can
      // actually match.
      await branches.fill("feat/*");
      await expect(
        page.getByRole("button", { name: "Save", exact: true }),
      ).toBeEnabled();
    });
  });
});
