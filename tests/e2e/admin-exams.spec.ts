import { expect, test } from "@playwright/test";
import { and, eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { signInAs, signUpViaApi, uniqueEmail } from "./support/accounts";

/**
 * The admin view of sittings.
 *
 * Two claims worth proving through the UI: that voiding requires its own
 * permission and its own reason, and that a void is recorded rather than
 * hidden — the row stays, the reason shows, and the mark stops counting.
 */

test.describe.configure({ timeout: 120_000, mode: "serial" });

let db: SeedDatabase;
let close: () => Promise<void>;

const SLUG = "periodic-table-basics";

/** The candidate whose sitting the void test strikes out. */
let voidableEmail: string;

test.beforeAll(() => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));
});

test.afterAll(async () => {
  await close?.();
});

test.describe("exam results", () => {
  test("lists every quiz with its sitting counts", async ({ page }) => {
    await signInAs(page, db, "admin");
    await page.goto("/admin/exams");

    await expect(
      page.getByRole("heading", { name: /exam results/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /periodic table/i }),
    ).toBeVisible();
  });

  test("shows the distribution, the per-question numbers and the sittings", async ({
    page,
  }) => {
    // A real sitting first, so the screen has something to show.
    await page.goto("/");
    const email = uniqueEmail("admin-exams");
    voidableEmail = email;
    await signUpViaApi(page, email);
    await page.goto(`/quiz/${SLUG}`);
    await page.getByRole("button", { name: /start quiz/i }).click();
    await page.waitForURL(/\/quiz\/.+\/attempt/);
    for (let i = 0; i < 10; i++) {
      await page.getByTestId("quiz-option").first().click();
      const next = page.getByRole("button", { name: /^next question$/i });
      if (await next.isVisible()) await next.click();
    }
    await page.getByRole("button", { name: /submit answers/i }).click();
    await page.waitForURL(/\/attempts\//);

    await signInAs(page, db, "admin");
    await page.goto(`/admin/exams/${SLUG}`);

    await expect(
      page.getByRole("heading", { name: /score distribution/i }),
    ).toBeVisible();
    // The numbers are readable without the chart — a chart nobody can read
    // with a screen reader is decoration.
    await expect(page.getByText(/read the numbers instead/i)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /per question/i }),
    ).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
  });

  test("voids a sitting only with a reason, and records it", async ({
    page,
  }) => {
    await signInAs(page, db, "admin");
    await page.goto(`/admin/exams/${SLUG}`);

    const voidButton = page.getByRole("button", { name: /^void$/i }).first();
    await expect(voidButton).toBeVisible();
    await voidButton.click();

    // A one-click void with an optional note is how a record ends up struck
    // out with nothing to explain it.
    const confirm = page.getByRole("button", { name: /void this attempt/i });
    await expect(confirm).toBeDisabled();

    const reason = page.getByLabel(/why is this being voided/i);
    await reason.fill("Suspected collusion");
    await expect(confirm).toBeEnabled();
    await confirm.click();

    // Waiting for the reason TEXT would match the textarea still holding what
    // was just typed, which is true before the action has done anything — the
    // first version of this test read the database while the void was still
    // in flight and found nothing. The form closing is the success signal.
    await expect(reason).toHaveCount(0, { timeout: 15_000 });
    // `.first()`: a local database accumulates voided sittings across runs, so
    // the reason can legitimately appear on several rows. CI starts clean and
    // sees one.
    await expect(page.getByText("Suspected collusion").first()).toBeVisible();

    const [row] = await db
      .select({
        status: schema.examAttempts.status,
        reason: schema.examAttempts.voidReason,
      })
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.voidReason, "Suspected collusion"));
    expect(row?.status).toBe("voided");

    // `after()` defers the activity write, so it is not immediate.
    let events: unknown[] = [];
    for (let i = 0; i < 20 && events.length === 0; i++) {
      events = await db
        .select({ id: schema.activityEvents.id })
        .from(schema.activityEvents)
        .where(eq(schema.activityEvents.verb, "exam.voided"));
      if (events.length === 0) await new Promise((r) => setTimeout(r, 250));
    }
    expect(events.length).toBeGreaterThan(0);

    await db
      .delete(schema.activityEvents)
      .where(eq(schema.activityEvents.verb, "exam.voided"));
  });

  test("shows a role without exam:read nothing of the section", async ({
    page,
  }) => {
    // `editor` writes the questions. That is no reason to see who scored what.
    await signInAs(page, db, "editor");
    const response = await page.goto("/admin/exams");
    expect(response?.status()).toBe(404);

    await page.goto("/admin");
    await expect(page.getByRole("link", { name: /exam results/i })).toHaveCount(
      0,
    );
  });
});
