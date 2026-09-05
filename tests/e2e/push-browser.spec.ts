import { expect, test } from "@playwright/test";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import { signInAs } from "./support/accounts";

/**
 * The browser half of push.
 *
 * Chromium cannot be made to deliver a real push here, so what is asserted is
 * everything up to that boundary: that the worker registers and takes over,
 * that the manifest is installable, that `sw.js` is never cached, and — the
 * one that matters most for trust — that nothing prompts for permission until
 * a person presses a button.
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

test.describe("the service worker", () => {
  test("registers and takes control of the page", async ({ page }) => {
    await page.goto("/");

    const state = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return {
        scope: registration.scope,
        hasActive: registration.active !== null,
      };
    });

    expect(state.hasActive).toBe(true);
    // Root scope, or it would not see pushes for the rest of the site.
    expect(new URL(state.scope).pathname).toBe("/");
  });

  test("is served with no-cache, so a deploy is not ignored", async ({
    page,
  }) => {
    // A cached worker keeps running the OLD copy indefinitely once installed —
    // which surfaces as "push stopped working for some people" rather than as
    // a caching bug.
    const response = await page.request.get("/sw.js");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-cache");
  });

  test("claims clients immediately rather than waiting for tabs to close", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);

    // `controller` is null until a worker has claimed this page. Without
    // `clients.claim()` the first load after an install is uncontrolled.
    await expect(async () => {
      const controlled = await page.evaluate(
        () => navigator.serviceWorker.controller !== null,
      );
      expect(controlled).toBe(true);
    }).toPass({ timeout: 10_000 });
  });
});

test.describe("the manifest", () => {
  test("is installable, which is what makes iOS push possible at all", async ({
    page,
  }) => {
    const response = await page.request.get("/manifest.webmanifest");
    expect(response.status()).toBe(200);

    const manifest = (await response.json()) as {
      display: string;
      start_url: string;
      icons: { sizes: string; purpose?: string }[];
    };

    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");

    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    // Without a maskable icon Android renders the ordinary one letterboxed
    // inside a white blob.
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(
      true,
    );
  });

  test("its icons actually exist", async ({ page }) => {
    for (const icon of [
      "/icons/icon-192.png",
      "/icons/icon-512.png",
      "/icons/icon-maskable-512.png",
      "/icons/badge-72.png",
    ]) {
      const response = await page.request.get(icon);
      expect(response.status(), icon).toBe(200);
      expect(response.headers()["content-type"]).toContain("image/png");
    }
  });
});

test.describe("permission", () => {
  /**
   * The toggle renders nothing when the deployment has no VAPID keys — a
   * control that cannot work is worse than no control — so these two assert
   * CONFIGURED behaviour and need a key. CI sets a throwaway pair; a
   * contributor without one gets a skip rather than a failure about a feature
   * they cannot run.
   */
  const configured = Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);

  test("is never requested on page load", async ({ page }) => {
    // The single most reliable way to be refused for ever. Asserted by
    // replacing the API and checking nobody called it.
    await page.addInitScript(() => {
      (window as unknown as { __asked: boolean }).__asked = false;
      if (typeof Notification !== "undefined") {
        Notification.requestPermission = () => {
          (window as unknown as { __asked: boolean }).__asked = true;
          return Promise.resolve("default" as NotificationPermission);
        };
      }
    });

    await page.goto("/");
    await page.waitForTimeout(1500);

    const asked = await page.evaluate(
      () => (window as unknown as { __asked: boolean }).__asked,
    );
    expect(asked).toBe(false);
  });

  test("is offered on the settings page, behind a button", async ({ page }) => {
    test.skip(!configured, "needs NEXT_PUBLIC_VAPID_PUBLIC_KEY");

    // "Never asked yet" has to be STATED, not assumed. A headless Chromium
    // reports `Notification.permission === "denied"` out of the box — it has
    // no UI to show a dialog in, so it answers as though the request had
    // already been refused — and granting the permission through Playwright
    // moves it to "granted", never to "default". Neither is the state this
    // test is about, and without the override the toggle correctly renders
    // the denied copy and this assertion fails for a reason that says nothing
    // about the product. Same technique as the denied test below, in the
    // opposite direction.
    await page.addInitScript(() => {
      Object.defineProperty(Notification, "permission", {
        configurable: true,
        get: () => "default",
      });
    });

    await signInAs(page, db, "member");
    await page.goto("/profile/settings");

    await expect(
      page.getByRole("heading", { name: /notifications/i }),
    ).toBeVisible();

    // The control is a button the reader chooses to press — not a dialog that
    // appeared at them.
    await expect(
      page.getByRole("button", { name: /turn on notifications/i }),
    ).toBeVisible();
  });

  test("shows no enable button once permission is denied", async ({ page }) => {
    test.skip(!configured, "needs NEXT_PUBLIC_VAPID_PUBLIC_KEY");
    // The browser will not show its dialog again, so a button that "asks"
    // would do nothing and look broken.
    await page.addInitScript(() => {
      Object.defineProperty(Notification, "permission", {
        configurable: true,
        get: () => "denied",
      });
    });

    await signInAs(page, db, "member");
    await page.goto("/profile/settings");

    await expect(page.getByText(/blocked for this site/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /turn on notifications/i }),
    ).toHaveCount(0);
  });
});
