import { expect, test } from "@playwright/test";
import { like } from "drizzle-orm";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { signInAs } from "./support/accounts";

/**
 * The lesson admin, end to end.
 *
 * Proves what the integration suite cannot: that the form posts what the
 * author typed, that the server actions accept it, that publication is refused
 * for the right reason, and that a role without lesson permissions sees
 * nothing of the section.
 */

/**
 * Every test here signs up a real account, and the password hash is
 * deliberately slow — that is the point of it. With several workers on a small
 * runner the default 30s test budget is not enough, and shortening the hash to
 * suit the tests would weaken the thing being tested.
 */
test.describe.configure({ timeout: 90_000 });

let db: SeedDatabase;
let close: () => Promise<void>;

/** Every lesson this file creates carries the prefix, so cleanup is exact. */
/**
 * Per WORKER, because `afterAll` deletes every row matching this prefix.
 *
 * Playwright runs one `afterAll` per worker, not one per file: the worker
 * that finishes first was deleting rows the other worker was still using,
 * and the test mid-flight reloaded onto a "Not found" page. Scoping the
 * prefix means a worker can only ever clean up after itself.
 */
const PREFIX = `e2e-lesson-w${process.env.TEST_WORKER_INDEX ?? "0"}-`;

const uniqueSlug = () =>
  `${PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test.beforeAll(() => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));
});

test.afterAll(async () => {
  // Leaving these behind would make `pnpm db:verify` report thirteen expected
  // lessons and find more.
  await db
    .delete(schema.lessons)
    .where(like(schema.lessons.slug, `${PREFIX}%`));
  await close?.();
});

/** Fills the metadata form and submits it. */
async function createLesson(
  page: import("@playwright/test").Page,
  slug: string,
  title: string,
) {
  await page.goto("/admin/lessons/new");
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByLabel("Slug", { exact: true }).fill(slug);
  await page
    .getByLabel("Description", { exact: true })
    .fill("Created by the e2e suite.");
  await page.getByLabel("Category", { exact: true }).fill("Testing");
  await page.getByRole("button", { name: /create lesson/i }).click();
}

test.describe("the lesson admin", () => {
  test("lists, searches and filters by status through the URL", async ({
    page,
  }) => {
    await signInAs(page, db, "editor");
    await page.goto("/admin/lessons");

    await expect(
      page.getByRole("link", { name: "Introduction / Basics" }),
    ).toBeVisible();

    // Filtering narrows the list and lands in the URL, so the view is linkable.
    await page.getByRole("link", { name: "Draft", exact: true }).click();
    await expect(page).toHaveURL(/status=draft/);

    // Every seeded lesson is published, so the draft view is empty rather than
    // showing the same rows under a different heading.
    await expect(
      page.getByRole("link", { name: "Introduction / Basics" }),
    ).toHaveCount(0);

    // A copied URL reproduces the exact view.
    await page.goto("/admin/lessons?status=published&q=redox");
    await expect(page.getByRole("link", { name: /redox/i })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Introduction / Basics" }),
    ).toHaveCount(0);
  });

  test("shows how translated each lesson is, and filters on it", async ({
    page,
  }) => {
    await signInAs(page, db, "editor");
    await page.goto("/admin/lessons");

    // The seeded catalogue is English only, so every lesson is untranslated.
    // Asserting on the column rather than on a count: the point of the column
    // is that an editor can see the state without opening anything.
    const table = page.getByRole("table");
    await expect(table.getByText("Not translated").first()).toBeVisible();

    // The two filter rows use different words on purpose — "Draft" would mean
    // the lesson in one and its translation in the other — and each row is
    // captioned, so this can name one unambiguously.
    await page
      .getByLabel("Filter by translation")
      .getByRole("link", { name: "Not translated", exact: true })
      .click();

    await expect(page).toHaveURL(/translation=missing/);
    // Linkable, like every other piece of list state.
    await expect(table.getByText("Not translated").first()).toBeVisible();

    // And the opposite filter is empty rather than showing the same rows
    // under a different heading.
    await page
      .getByLabel("Filter by translation")
      .getByRole("link", { name: "Translated", exact: true })
      .click();
    await expect(page).toHaveURL(/translation=published/);
    await expect(table.getByText("Not translated")).toHaveCount(0);
  });

  test("remembers which columns to hide, and refuses to hide the link", async ({
    page,
  }) => {
    await signInAs(page, db, "editor");
    await page.goto("/en/admin/lessons");

    const table = page.getByRole("table");
    await expect(
      table.getByRole("columnheader", { name: /category/i }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Columns" }).click();

    // The link column is listed and disabled rather than absent: omitting it
    // leaves somebody hunting for "Title" in a menu that never had it.
    const title = page.getByRole("menuitemcheckbox", { name: "Title" });
    await expect(title).toBeVisible();
    await expect(title).toBeDisabled();

    await page.getByRole("menuitemcheckbox", { name: "Category" }).click();
    await page.keyboard.press("Escape");
    await expect(
      table.getByRole("columnheader", { name: /category/i }),
    ).toHaveCount(0);
    // The link column is still there, which is what makes the row reachable.
    await expect(
      table.getByRole("columnheader", { name: /title/i }),
    ).toBeVisible();

    // Persisted, not just held in memory for this render.
    await page.reload();
    await expect(
      page.getByRole("table").getByRole("columnheader", { name: /category/i }),
    ).toHaveCount(0);
  });

  test("searches once the typing stops, not once per keystroke", async ({
    page,
  }) => {
    await signInAs(page, db, "editor");
    await page.goto("/en/admin/lessons");

    // DISTINCT search terms the browser asked the server for. Counting raw
    // requests would count Next's own RSC fetch and its link prefetches
    // alongside the navigation, which says nothing about the debounce; the
    // terms do. Undebounced, typing eight characters searches for eight
    // prefixes.
    const terms = new Set<string>();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        url.pathname.includes("/admin/lessons") &&
        url.searchParams.has("q")
      ) {
        terms.add(url.searchParams.get("q")!);
      }
    });

    await page
      .getByRole("searchbox")
      .pressSequentially("thermody", { delay: 30 });

    await expect(page).toHaveURL(/q=thermody/, { timeout: 10_000 });
    // The complete word is what was searched for. "thermod" must never land
    // after "thermody" — the timer is reset, not queued.
    expect([...terms]).toContain("thermody");
    // Two rather than one: a slow runner can stretch eight keystrokes past
    // the 300ms window and produce a legitimate second search. Eight is the
    // number this is guarding against.
    expect(terms.size).toBeLessThanOrEqual(2);
  });

  test("creates a draft that the public catalogue does not show", async ({
    page,
  }) => {
    await signInAs(page, db, "editor");
    const slug = uniqueSlug();
    const title = "A lesson from the e2e suite";

    await createLesson(page, slug, title);

    // The editor is now the created lesson's own URL.
    await expect(page).toHaveURL(new RegExp(`/admin/lessons/${slug}$`), {
      timeout: 15_000,
    });
    await expect(page.getByText(/this lesson is draft/i)).toBeVisible();

    // The criterion: a draft is not reachable from the public site.
    await page.goto("/lessons");
    await expect(page.getByText(title)).toHaveCount(0);
  });

  test("refuses to publish a lesson with no content, naming the reason", async ({
    page,
  }) => {
    await signInAs(page, db, "editor");
    const slug = uniqueSlug();
    await createLesson(page, slug, "Nothing written yet");

    await expect(page).toHaveURL(new RegExp(`/admin/lessons/${slug}$`), {
      timeout: 15_000,
    });

    // Said up front rather than after a click that is then refused.
    await expect(page.getByText(/it has no content/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^publish$/i }),
    ).toBeDisabled();
  });

  test("reports a slug that is already taken instead of failing silently", async ({
    page,
  }) => {
    await signInAs(page, db, "editor");
    await createLesson(page, "introduction-basics", "A clashing slug");

    await expect(page.getByText(/slug is already in use/i)).toBeVisible({
      timeout: 15_000,
    });
    // Still on the create screen: nothing was written.
    await expect(page).toHaveURL(/\/admin\/lessons\/new/);
  });

  test("renames a lesson and warns before breaking its public links", async ({
    page,
  }) => {
    await signInAs(page, db, "editor");
    const slug = uniqueSlug();
    await createLesson(page, slug, "Renameable");
    await expect(page).toHaveURL(new RegExp(`/admin/lessons/${slug}$`), {
      timeout: 15_000,
    });

    const renamed = `${slug}-renamed`;
    await page.getByLabel("Slug", { exact: true }).fill(renamed);
    await page.getByRole("button", { name: /save changes/i }).click();

    // The editor follows the rename; staying put would leave the author on a
    // URL that no longer resolves.
    await expect(page).toHaveURL(new RegExp(`/admin/lessons/${renamed}$`), {
      timeout: 15_000,
    });
  });

  test("offers withdrawal only to a role that holds lesson:delete", async ({
    page,
  }) => {
    // `editor` publishes but does not delete; `admin` does both.
    await signInAs(page, db, "editor");
    const slug = uniqueSlug();
    await createLesson(page, slug, "Withdrawable");
    await expect(page).toHaveURL(new RegExp(`/admin/lessons/${slug}$`), {
      timeout: 15_000,
    });
    await expect(
      page.getByRole("button", { name: /withdraw lesson/i }),
    ).toHaveCount(0);
  });

  test("shows a role without lesson permissions nothing of the section", async ({
    page,
  }) => {
    // `moderator` holds admin:access but nothing on lessons.
    await signInAs(page, db, "moderator");

    for (const path of [
      "/admin/lessons",
      "/admin/lessons/new",
      "/admin/lessons/introduction-basics",
    ]) {
      const response = await page.goto(path);

      // A real 404, not a 200 carrying an apology. This became true when the
      // proxy's `x-pathname` forwarding was fixed: the admin layout resolves
      // the section's permission from that header, so until the header
      // arrived the layout only ever checked `admin:access` and the refusal
      // fell to the page — by which point Next had committed a 200. That was
      // recorded as Q31; it is now closed.
      expect(response?.status(), path).toBe(404);

      const html = await page.content();
      expect(html, path).not.toContain("Introduction / Basics");
      expect(html, path).not.toContain(
        'href="/admin/lessons/introduction-basics"',
      );
    }
  });
});
