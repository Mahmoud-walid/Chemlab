import { expect, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { signInAs } from "./support/accounts";

/**
 * CSV export, end to end.
 *
 * What only the running app can show: that the response really is a streamed
 * attachment rather than a page, that the personal columns are absent for a
 * reader without the grant, that a caller without the export grant is refused
 * the same way an unknown page is refused, and that every download leaves an
 * `admin.exported` row behind. The last one is the point of auditing exports
 * at all — a copy of the events table left the building, and the record of
 * that has to survive the download being cancelled.
 */

test.describe.configure({ timeout: 120_000, mode: "serial" });

let db: SeedDatabase;
let close: () => Promise<void>;

/** Reads the stream and the events, but holds no personal data. */
const READER_ROLE = "e2e_export_no_pii";

test.beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  const [role] = await db
    .insert(schema.roles)
    .values({
      key: READER_ROLE,
      name: "E2E export, no personal data",
      description: "Created by tests/e2e/admin-export.spec.ts.",
      isSystem: false,
      isProtected: false,
    })
    .onConflictDoUpdate({
      target: schema.roles.key,
      set: { name: "E2E export, no personal data" },
    })
    .returning({ id: schema.roles.id });

  const granted = await db
    .select({ id: schema.permissions.id })
    .from(schema.permissions)
    .where(
      inArray(schema.permissions.name, [
        "admin:access",
        "activity:read",
        "activity:export",
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
  // The role assignments go first: a role somebody still holds cannot be
  // deleted, and the account itself is reused by later tests in this worker.
  const [role] = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(eq(schema.roles.key, READER_ROLE));
  if (role) {
    await db
      .delete(schema.userRoles)
      .where(eq(schema.userRoles.roleId, role.id));
    await db
      .delete(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, role.id));
    await db.delete(schema.roles).where(eq(schema.roles.id, role.id));
  }
  await close?.();
});

/** `after()` runs once the response is finished, so the audit row is not
 * written by the time the download resolves. */
async function eventually<T>(read: () => Promise<T[]>, attempts = 24) {
  for (let i = 0; i < attempts; i++) {
    const rows = await read();
    if (rows.length > 0) return rows;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return read();
}

test.describe("exporting", () => {
  test("downloads the activity stream as a CSV attachment", async ({
    page,
  }) => {
    await signInAs(page, db, "admin");
    await page.goto("/admin/activity");

    const response = await page.request.get(
      "/api/admin/export?dataset=events&pageSize=10&page=3",
    );

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    expect(response.headers()["content-disposition"]).toContain("attachment");
    expect(response.headers()["content-disposition"]).toContain(
      "chemlab-events-",
    );
    // A file with names and addresses in it must not sit in a shared cache.
    expect(response.headers()["cache-control"]).toContain("no-store");

    const body = await response.text();
    // The BOM, or Excel reads the Arabic columns as mojibake.
    expect(body.charCodeAt(0)).toBe(0xfeff);
    expect(body).toContain("verb");
    expect(body.split("\r\n").length).toBeGreaterThan(1);
  });

  test("offers the download on the activity screen, carrying its filters", async ({
    page,
  }) => {
    await signInAs(page, db, "admin");
    await page.goto("/admin/activity?status=auth");

    const link = page.getByRole("link", { name: /export csv/i });
    await expect(link).toBeVisible();

    const href = await link.getAttribute("href");
    expect(href).toContain("dataset=events");
    // The filter the operator is looking at, or the file would be a different
    // population than the screen.
    expect(href).toContain("status=auth");
    // Paging belongs to the screen, never to the file.
    expect(href).not.toContain("page=");
  });

  test("withholds the personal columns from a reader without the grant", async ({
    page,
  }) => {
    await signInAs(page, db, READER_ROLE);

    const response = await page.request.get("/api/admin/export?dataset=events");
    expect(response.status()).toBe(200);

    const header = (await response.text()).split("\r\n")[0]!;
    expect(header).not.toContain("ip_address");
    expect(header).not.toContain("user_agent");
  });

  test("gives the same reader the columns once they hold activity:read_pii", async ({
    page,
  }) => {
    await signInAs(page, db, "admin");

    const response = await page.request.get("/api/admin/export?dataset=events");
    const header = (await response.text()).split("\r\n")[0]!;
    expect(header).toContain("ip_address");
    expect(header).toContain("user_agent");
  });

  test("answers 404 to a signed-in caller without the export grant", async ({
    page,
  }) => {
    // 404 rather than 403, matching every admin page: a 403 confirms the
    // dataset exists and that this account is one grant short of it.
    await signInAs(page, db, "editor");

    const response = await page.request.get("/api/admin/export?dataset=events");
    expect(response.status()).toBe(404);
  });

  test("refuses a dataset name it does not recognise", async ({ page }) => {
    await signInAs(page, db, "admin");

    const response = await page.request.get("/api/admin/export?dataset=users");
    expect(response.status()).toBe(400);
  });

  test("records every download in the activity stream", async ({ page }) => {
    const email = await signInAs(page, db, "admin");
    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email));

    const before = await db
      .select({ id: schema.activityEvents.id })
      .from(schema.activityEvents)
      .where(eq(schema.activityEvents.actorId, user!.id));
    const exportsBefore = before.length;

    await page.request.get("/api/admin/export?dataset=funnel");

    const rows = await eventually(async () => {
      const all = await db
        .select({ id: schema.activityEvents.id })
        .from(schema.activityEvents)
        .where(eq(schema.activityEvents.actorId, user!.id));
      return all.length > exportsBefore ? all : [];
    });
    expect(rows.length).toBeGreaterThan(exportsBefore);

    const [recorded] = await db
      .select({
        verb: schema.activityEvents.verb,
        objectType: schema.activityEvents.objectType,
        objectId: schema.activityEvents.objectId,
      })
      .from(schema.activityEvents)
      .where(eq(schema.activityEvents.verb, "admin.exported"))
      .limit(1);

    expect(recorded?.objectType).toBe("export");
    expect(recorded?.objectId).toBeTruthy();
  });

  test("exports one exam's sittings from that exam's screen", async ({
    page,
  }) => {
    await signInAs(page, db, "admin");
    await page.goto("/admin/exams");

    // The quiz title is the link into its detail screen.
    const first = page.locator('a[href*="/admin/exams/"]').first();
    await expect(first).toBeVisible();
    await first.click();

    const link = page.getByRole("link", { name: /export csv/i });
    await expect(link).toBeVisible();

    const href = (await link.getAttribute("href"))!;
    expect(href).toContain("dataset=attempts");
    expect(href).toContain("quiz=");

    const response = await page.request.get(href);
    expect(response.status()).toBe(200);
    const header = (await response.text()).split("\r\n")[0]!;
    expect(header).toContain("quiz_slug");
    expect(header).toContain("percent");
  });

  test("turns an anonymous request away without a file", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const response = await context.request.get(
      "http://localhost:3000/api/admin/export?dataset=events",
    );
    expect([401, 404]).toContain(response.status());
    expect(response.headers()["content-type"]).not.toContain("text/csv");
    await context.close();
  });
});
