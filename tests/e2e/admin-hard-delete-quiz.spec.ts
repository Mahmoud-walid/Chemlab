import { expect, test } from "@playwright/test";
import { and, eq, like } from "drizzle-orm";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { createQuiz } from "../factories";
import { signInAs } from "./support/accounts";

/**
 * Erasing a quiz, end to end.
 *
 * The lesson spec proves the shared shape — the button's absence, the typed
 * confirmation, the refusal as a sentence. What is only true here is which
 * reference does the refusing: a quiz cannot be commented on, and the thing
 * that makes it history is somebody having SAT it.
 */

/**
 * Serial, and not because of speed.
 *
 * These tests grant `quiz:delete_hard` to the shared `admin` role for their
 * duration, and one asserts that no role holds it. `fullyParallel` splits a
 * single file across workers, so in parallel that test can read the role
 * while another has it granted. Serial is the honest fix: they share mutable
 * global state, so they cannot run at the same time.
 */
test.describe.configure({ mode: "serial", timeout: 120_000 });

let db: SeedDatabase;
let close: () => Promise<void>;

const PREFIX = `e2e-eraseq-w${process.env.TEST_WORKER_INDEX ?? "0"}-`;

test.beforeAll(() => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));
});

test.afterAll(async () => {
  await db
    .delete(schema.quizzes)
    .where(like(schema.quizzes.slug, `${PREFIX}%`));
  await close?.();
});

async function draft(name: string) {
  return createQuiz(db, {
    slug: `${PREFIX}${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: `Erase ${name}`,
    description: "Made while learning the editor.",
    questions: 1,
    answerable: true,
  });
}

/** Any account, to hang an attempt on. Which one is irrelevant here. */
async function anyUserId(): Promise<string> {
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .limit(1);
  return user!.id;
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
    .where(eq(schema.permissions.name, "quiz:delete_hard"));

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

test.describe("erasing a quiz", () => {
  test("offers nothing to an admin, because no role holds the permission", async ({
    page,
  }) => {
    await signInAs(page, db, "admin");
    const quiz = await draft("hidden");
    await page.goto(`/en/admin/quizzes/${quiz.slug}`);

    // The default state of the whole feature: Admin can withdraw a quiz and
    // cannot erase one, until a Super Admin decides otherwise.
    await expect(page.getByRole("button", { name: /withdraw/i })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Erase permanently" }),
    ).toHaveCount(0);
  });

  test("erases a draft once the permission is granted", async ({ page }) => {
    await withPermission("admin", async () => {
      await signInAs(page, db, "admin");
      const quiz = await draft("gone");
      await page.goto(`/en/admin/quizzes/${quiz.slug}`);

      await page.getByRole("button", { name: "Erase permanently" }).click();

      // The slug, typed. The same interruption withdrawing uses, for a change
      // that is strictly worse: a withdrawn quiz comes back, and this takes
      // its questions and options with it.
      const confirm = page.getByRole("alertdialog");
      await expect(confirm).toBeVisible();
      const action = confirm.getByRole("button", { name: "Erase permanently" });
      await expect(action).toBeDisabled();

      await confirm.getByRole("textbox").fill(quiz.slug);
      await expect(action).toBeEnabled();
      await action.click();

      // Back to the list, and the row is gone from the database.
      await expect(page).toHaveURL(/\/admin\/quizzes$/, { timeout: 15_000 });
      const rows = await db
        .select({ id: schema.quizzes.id })
        .from(schema.quizzes)
        .where(eq(schema.quizzes.id, quiz.id));
      expect(rows).toHaveLength(0);

      // And so are its questions, by cascade rather than by a second delete.
      const questions = await db
        .select({ id: schema.quizQuestions.id })
        .from(schema.quizQuestions)
        .where(eq(schema.quizQuestions.quizId, quiz.id));
      expect(questions).toHaveLength(0);
    });
  });

  test("refuses a quiz somebody has sat, saying why", async ({ page }) => {
    await withPermission("admin", async () => {
      await signInAs(page, db, "admin");
      const quiz = await draft("attempted");

      // A result, not a mistake. The attempt is written directly because
      // starting one through the UI needs the quiz published — and a
      // published quiz would be refused for a different reason, which is not
      // the one this test is about.
      await db.insert(schema.examAttempts).values({
        quizId: quiz.id,
        userId: await anyUserId(),
        attemptNumber: 1,
        seed: 1,
        quizRevision: new Date(),
        status: "submitted",
        submittedAt: new Date(),
      });

      await page.goto(`/en/admin/quizzes/${quiz.slug}`);
      await page.getByRole("button", { name: "Erase permanently" }).click();

      const confirm = page.getByRole("alertdialog");
      await confirm.getByRole("textbox").fill(quiz.slug);
      await confirm.getByRole("button", { name: "Erase permanently" }).click();

      // The reason, as a sentence — not a failed request an operator has to
      // interpret. The button is shown because the row LOOKS erasable; the
      // server is where the reference check lives.
      //
      // Scoped to the panel. The toast carries the same words — twice, since
      // sonner renders an aria-live mirror for screen readers — and the panel
      // is the part that stays on screen for the operator to read.
      const panel = page.getByLabel("Publication").getByRole("alert");
      await expect(panel).toBeVisible({ timeout: 15_000 });
      await expect(panel).toContainText("This quiz cannot be erased");
      await expect(panel).toContainText("Somebody has sat it.");

      // And it is still there.
      const rows = await db
        .select({ id: schema.quizzes.id })
        .from(schema.quizzes)
        .where(eq(schema.quizzes.id, quiz.id));
      expect(rows).toHaveLength(1);
    });
  });
});
