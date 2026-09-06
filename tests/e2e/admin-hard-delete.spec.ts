import { expect, test } from "@playwright/test";
import { and, eq, like } from "drizzle-orm";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { createComment } from "@/db/queries/comments";
import { signInAs } from "./support/accounts";

/**
 * Erasing a lesson, end to end.
 *
 * The two things a browser can prove that nothing else can: that the button
 * is simply absent for an account without the permission — which is every
 * account by default — and that the refusals reach the operator as sentences
 * rather than as a failed request.
 */

/**
 * Serial, and not because of speed.
 *
 * Two of these tests grant `lesson:delete_hard` to the shared `admin` role
 * for their duration, and one asserts that no role holds it. `fullyParallel`
 * splits a single file across workers, so in parallel the third test can read
 * the role while another test has it granted — and it failed exactly that way
 * before this line existed. Serial is the honest fix: the tests share mutable
 * global state, so they cannot run at the same time.
 */
test.describe.configure({ mode: "serial", timeout: 120_000 });

let db: SeedDatabase;
let close: () => Promise<void>;

const PREFIX = `e2e-erase-w${process.env.TEST_WORKER_INDEX ?? "0"}-`;

test.beforeAll(() => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));
});

test.afterAll(async () => {
  await db
    .delete(schema.lessons)
    .where(like(schema.lessons.slug, `${PREFIX}%`));
  await close?.();
});

async function draft(name: string) {
  const slug = `${PREFIX}${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [lesson] = await db
    .insert(schema.lessons)
    .values({
      slug,
      title: `Erase ${name}`,
      description: "Made while learning the editor.",
      difficulty: "easy",
      category: "Testing",
      status: "draft",
    })
    .returning({ id: schema.lessons.id });
  return { id: lesson!.id, slug };
}

/** Any account, to hang a comment on. Which one is irrelevant here. */
async function anyUserId(): Promise<string | undefined> {
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .limit(1);
  return user?.id;
}

/** Grants the permission to a role for this test only, then takes it back. */
async function withPermission(roleKey: string, run: () => Promise<void>) {
  const [role] = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(eq(schema.roles.key, roleKey));
  const [permission] = await db
    .select({ id: schema.permissions.id })
    .from(schema.permissions)
    .where(eq(schema.permissions.name, "lesson:delete_hard"));

  await db
    .insert(schema.rolePermissions)
    .values({ roleId: role!.id, permissionId: permission!.id })
    .onConflictDoNothing();

  try {
    await run();
  } finally {
    await db
      .delete(schema.rolePermissions)
      .where(
        and(
          eq(schema.rolePermissions.roleId, role!.id),
          eq(schema.rolePermissions.permissionId, permission!.id),
        ),
      );
  }
}

test.describe("erasing a lesson", () => {
  test("offers nothing to an admin, because no role holds the permission", async ({
    page,
  }) => {
    await signInAs(page, db, "admin");
    const lesson = await draft("hidden");
    await page.goto(`/en/admin/lessons/${lesson.slug}`);

    // The default state of the whole feature: Admin can withdraw a lesson and
    // cannot erase one, until a Super Admin decides otherwise.
    await expect(page.getByRole("button", { name: /withdraw/i })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Erase permanently" }),
    ).toHaveCount(0);
  });

  test("erases a draft once the permission is granted", async ({ page }) => {
    await withPermission("admin", async () => {
      await signInAs(page, db, "admin");
      const lesson = await draft("gone");
      await page.goto(`/en/admin/lessons/${lesson.slug}`);

      await page.getByRole("button", { name: "Erase permanently" }).click();

      // The slug, typed. The same interruption withdrawing uses, for a change
      // that is strictly worse: a withdrawn lesson comes back.
      const confirm = page.getByRole("alertdialog");
      await expect(confirm).toBeVisible();
      const action = confirm.getByRole("button", {
        name: "Erase permanently",
      });
      await expect(action).toBeDisabled();

      await confirm.getByRole("textbox").fill(lesson.slug);
      await expect(action).toBeEnabled();
      await action.click();

      // Back to the list, and the row is gone from the database.
      await expect(page).toHaveURL(/\/admin\/lessons$/, { timeout: 15_000 });
      const rows = await db
        .select({ id: schema.lessons.id })
        .from(schema.lessons)
        .where(eq(schema.lessons.id, lesson.id));
      expect(rows).toHaveLength(0);
    });
  });

  test("refuses a lesson somebody has commented on, saying why", async ({
    page,
  }) => {
    await withPermission("admin", async () => {
      await signInAs(page, db, "admin");
      const lesson = await draft("commented");

      // Referenced, so it is history rather than a mistake. Written through
      // the real writer, which fills in the threading columns.
      await createComment(db, {
        subjectType: "lesson",
        subjectId: lesson.id,
        authorId: (await anyUserId())!,
        body: "A question about this lesson.",
      });

      await page.goto(`/en/admin/lessons/${lesson.slug}`);
      await page.getByRole("button", { name: "Erase permanently" }).click();

      const confirm = page.getByRole("alertdialog");
      await confirm.getByRole("textbox").fill(lesson.slug);
      await confirm.getByRole("button", { name: "Erase permanently" }).click();

      // The reason, as a sentence — not a failed request an operator has to
      // interpret. The button is shown because the row LOOKS erasable; the
      // server is where the reference check lives.
      // Scoped to the panel. The toast carries the same words — twice, since
      // sonner renders an aria-live mirror for screen readers — and the panel
      // is the part that stays on screen for the operator to read.
      const panel = page.getByLabel("Publication").getByRole("alert");
      await expect(panel).toBeVisible({ timeout: 15_000 });
      await expect(panel).toContainText("This lesson cannot be erased");
      await expect(panel).toContainText("Somebody has commented on it.");

      // And it is still there.
      const rows = await db
        .select({ id: schema.lessons.id })
        .from(schema.lessons)
        .where(eq(schema.lessons.id, lesson.id));
      expect(rows).toHaveLength(1);
    });
  });
});
