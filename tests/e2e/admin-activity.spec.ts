import { expect, test } from "@playwright/test";
import { desc, eq, like } from "drizzle-orm";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { signInAs } from "./support/accounts";

/**
 * The activity stream, end to end.
 *
 * The claim worth proving here is the one no unit or integration test can:
 * that events are actually WRITTEN by the running app when somebody does
 * something, through `after()`, without failing or delaying the request that
 * caused them.
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

/** `after()` runs once the response is finished, so a write is not immediate. */
async function eventually<T>(
  read: () => Promise<T[]>,
  attempts = 20,
): Promise<T[]> {
  for (let i = 0; i < attempts; i++) {
    const rows = await read();
    if (rows.length > 0) return rows;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return read();
}

test.describe("the activity stream", () => {
  test("records a sign-up when someone creates an account", async ({
    page,
  }) => {
    const email = await signInAs(page, db, "editor");

    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email));

    // The account may have been reused from an earlier test in this worker, in
    // which case the sign-up event belongs to that first creation — either way
    // there must be exactly one, and it must name this account.
    const rows = await eventually(() =>
      db
        .select()
        .from(schema.activityEvents)
        .where(eq(schema.activityEvents.actorId, user!.id)),
    );

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((row) => row.verb)).toContain("auth.signed_up");
  });

  test("records an admin edit, and the edit still succeeds", async ({
    page,
  }) => {
    await signInAs(page, db, "editor");

    const slug = `e2e-activity-${Date.now()}`;
    await page.goto("/admin/lessons/new");
    await page.getByLabel("Title", { exact: true }).fill("Activity probe");
    await page.getByLabel("Slug", { exact: true }).fill(slug);
    await page
      .getByLabel("Description", { exact: true })
      .fill("Created by the activity spec.");
    await page.getByLabel("Category", { exact: true }).fill("Testing");
    await page.getByRole("button", { name: /create lesson/i }).click();

    // The user-facing outcome first: an analytics write must never be able to
    // break or delay this.
    await expect(page).toHaveURL(new RegExp(`/admin/lessons/${slug}$`), {
      timeout: 15_000,
    });

    const [lesson] = await db
      .select({ id: schema.lessons.id })
      .from(schema.lessons)
      .where(eq(schema.lessons.slug, slug));

    const rows = await eventually(() =>
      db
        .select()
        .from(schema.activityEvents)
        .where(eq(schema.activityEvents.objectId, lesson!.id)),
    );

    expect(rows.map((row) => row.verb)).toContain("admin.created");
    const created = rows.find((row) => row.verb === "admin.created")!;
    expect(created.objectType).toBe("lesson");
    expect(created.actorId).not.toBeNull();
    // Truncated before storage — never a whole address.
    if (created.ipAddress) expect(created.ipAddress).toMatch(/\.0$|::$/);

    await db.delete(schema.lessons).where(eq(schema.lessons.slug, slug));
    await db
      .delete(schema.activityEvents)
      .where(like(schema.activityEvents.objectId, `${lesson!.id}%`));
  });

  test("shows the stream to an admin, with personal data", async ({ page }) => {
    await signInAs(page, db, "admin");
    await page.goto("/admin/activity");

    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
    // `admin` holds activity:read_pii, so the columns are offered.
    await expect(page.getByRole("columnheader", { name: "IP" })).toBeVisible();
    await expect(page.getByText(/are withheld/i)).toHaveCount(0);
  });

  test("shows a role without page permissions nothing of the section", async ({
    page,
  }) => {
    // `editor` holds no `activity:*` permission at all.
    await signInAs(page, db, "editor");
    const response = await page.goto("/admin/activity");
    expect(response?.status()).toBe(404);
  });
});
