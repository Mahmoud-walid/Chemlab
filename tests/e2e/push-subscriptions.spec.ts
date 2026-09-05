import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { signInAs } from "./support/accounts";

/**
 * The subscription endpoint.
 *
 * What the browser settles that a unit test cannot: that the route is actually
 * wired to a session, and that re-registering the same device updates one row
 * rather than accumulating them — the failure that turns one notification into
 * ten copies for a user who reloaded a settings page.
 */

test.describe.configure({ timeout: 90_000, mode: "serial" });

let db: SeedDatabase;
let close: () => Promise<void>;

const ENDPOINT = `https://push.test/e2e-${Date.now()}`;

const BODY = {
  endpoint: ENDPOINT,
  keys: { p256dh: "B".repeat(87), auth: "C".repeat(22) },
};

test.beforeAll(() => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));
});

test.afterAll(async () => {
  await db
    .delete(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.endpoint, ENDPOINT));
  await close?.();
});

async function rows() {
  return db
    .select({
      id: schema.pushSubscriptions.id,
      userId: schema.pushSubscriptions.userId,
      p256dh: schema.pushSubscriptions.p256dh,
    })
    .from(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.endpoint, ENDPOINT));
}

test.describe("push subscriptions", () => {
  test("refuses an anonymous subscription", async ({ browser }) => {
    // A row nobody could ever send to, and an open door to filling the table.
    const context = await browser.newContext();
    const response = await context.request.post(
      "http://localhost:3000/api/push/subscriptions",
      { data: BODY },
    );
    expect(response.status()).toBe(401);
    await context.close();
  });

  test("registers a device for a signed-in user", async ({ page }) => {
    await signInAs(page, db, "member");

    const response = await page.request.post("/api/push/subscriptions", {
      data: BODY,
    });
    expect(response.status()).toBe(201);
    expect(await rows()).toHaveLength(1);
  });

  test("subscribing the same device twice leaves one row", async ({ page }) => {
    await signInAs(page, db, "member");

    await page.request.post("/api/push/subscriptions", { data: BODY });
    await page.request.post("/api/push/subscriptions", {
      data: { ...BODY, keys: { ...BODY.keys, p256dh: "D".repeat(87) } },
    });

    const current = await rows();
    expect(current).toHaveLength(1);
    // And the keys are refreshed: a browser that rotated its keys must keep
    // receiving pushes, which means the newest values win.
    expect(current[0]!.p256dh).toBe("D".repeat(87));
  });

  test("refuses a subscription that is not an https endpoint", async ({
    page,
  }) => {
    await signInAs(page, db, "member");

    const response = await page.request.post("/api/push/subscriptions", {
      data: { ...BODY, endpoint: "http://push.test/insecure" },
    });
    expect(response.status()).toBe(400);
  });

  test("refuses a truncated key", async ({ page }) => {
    await signInAs(page, db, "member");

    const response = await page.request.post("/api/push/subscriptions", {
      data: { ...BODY, keys: { p256dh: "B", auth: "C" } },
    });
    expect(response.status()).toBe(400);
  });

  test("removes the device on request", async ({ page }) => {
    await signInAs(page, db, "member");
    await page.request.post("/api/push/subscriptions", { data: BODY });

    const response = await page.request.delete("/api/push/subscriptions", {
      data: { endpoint: ENDPOINT },
    });
    expect(response.status()).toBe(204);
    expect(await rows()).toHaveLength(0);
  });

  test("cannot remove somebody else's device", async ({ page }) => {
    // Scoped to the caller's own rows: without that clause this endpoint would
    // unsubscribe anybody for anybody who learned their endpoint.
    await signInAs(page, db, "member");
    await page.request.post("/api/push/subscriptions", { data: BODY });

    await signInAs(page, db, "editor");
    const response = await page.request.delete("/api/push/subscriptions", {
      data: { endpoint: ENDPOINT },
    });

    expect(response.status()).toBe(204);
    // The row survives, because it is not this caller's.
    expect(await rows()).toHaveLength(1);
  });
});
