import { expect, test } from "@playwright/test";

/**
 * Browsing the two reader catalogues: infinite scroll, and the search box.
 *
 * Here rather than in the unit suite because two of the three things that
 * matter only exist in a browser. The folding and the ranking are proven pure
 * in `tests/lib/search-*.test.ts` and the reveal arithmetic in
 * `tests/hooks/use-infinite-reveal.test.ts`; what is left is whether the
 * observer actually fires on a real scroll, and whether the whole catalogue is
 * reachable without one.
 *
 * Every navigation carries an explicit `/en` prefix. `localePrefix` is
 * `as-needed`, so next-intl remembers the last locale in a cookie — and a spec
 * that ran after an Arabic one would otherwise be asserting English button
 * names against an Arabic page, where every name misses and the failure reads
 * like a broken selector.
 */

/** 14 seeded lessons against a page size of 6: two reveals to reach the end. */
const LESSON_COUNT = 14;
const LESSON_PAGE = 6;
/** 6 seeded quizzes against a page size of 4: one reveal. */
const QUIZ_PAGE = 4;

const lessonRows = (page: import("@playwright/test").Page) =>
  page.getByRole("link", { name: /^read lesson:/i });

const quizRows = (page: import("@playwright/test").Page) =>
  page.getByRole("link", { name: /^start quiz:/i });

/**
 * Type into the search box, and be sure React received it.
 *
 * `fill()` sets the DOM value and dispatches an input event. If the page has
 * not hydrated yet — and these pages are server-rendered, so they LOOK ready
 * long before they are — nothing is listening, the value sits in the input and
 * the list never changes. That failed once in the full suite under parallel
 * load and passed every time in isolation, which is the shape of flake worth
 * fixing at the cause rather than by widening a timeout.
 *
 * The clear button is the proof of hydration, because it is rendered from the
 * state the keystroke was supposed to set. Retrying the fill until it appears
 * is the only signal available: nothing else on the page distinguishes
 * hydrated from not.
 */
async function search(
  page: import("@playwright/test").Page,
  text: string,
  // The clear button's accessible name, which is translated — the Arabic page
  // has no button called "Clear search", and defaulting silently would make
  // this helper time out for fifteen seconds and report a hydration failure
  // that never happened.
  clearLabel: RegExp = /clear search/i,
) {
  const box = page.getByRole("searchbox");
  await expect(async () => {
    await box.fill(text);
    await expect(page.getByRole("button", { name: clearLabel })).toBeVisible({
      timeout: 1_000,
    });
  }).toPass({ timeout: 15_000 });
}

test.describe("the lesson catalogue", () => {
  test("starts at one page rather than the whole curriculum", async ({
    page,
  }) => {
    await page.goto("/en/lessons");
    await expect(lessonRows(page)).toHaveCount(LESSON_PAGE);
  });

  test("reveals the rest as the reader scrolls", async ({ page }) => {
    await page.goto("/en/lessons");
    await expect(lessonRows(page)).toHaveCount(LESSON_PAGE);

    // Scrolling, not pressing — this is the assertion the unit tests cannot
    // make, because jsdom has no IntersectionObserver and does not scroll.
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 4000);
      if ((await lessonRows(page).count()) >= LESSON_COUNT) break;
    }

    await expect(lessonRows(page)).toHaveCount(LESSON_COUNT);
    // And the sentinel is gone once there is nothing left to reveal, rather
    // than sitting at the end of the list offering nothing.
    await expect(
      page.getByRole("button", { name: /show .* more/i }),
    ).toHaveCount(0);
  });

  test("is reachable to the end without an IntersectionObserver", async ({
    page,
  }) => {
    // The reason the sentinel is a button rather than a marker div. The
    // observer is removed before any script runs, which is the only way to
    // test the fallback honestly: with it present, merely scrolling the button
    // into view reveals the next page, so pressing it proves nothing.
    await page.addInitScript(() => {
      Object.defineProperty(window, "IntersectionObserver", {
        configurable: true,
        value: undefined,
      });
    });
    await page.goto("/en/lessons");
    await expect(lessonRows(page)).toHaveCount(LESSON_PAGE);

    for (let i = 0; i < 6; i++) {
      const more = page.getByRole("button", { name: /show .* more/i });
      if ((await more.count()) === 0) break;
      await more.first().click();
    }

    await expect(lessonRows(page)).toHaveCount(LESSON_COUNT);
  });

  test("searching narrows a list that has already been revealed", async ({
    page,
  }) => {
    await page.goto("/en/lessons");

    // Revealed first, so the search is applied to more than the initial page.
    // That the reveal RESETS to one page is asserted exactly, with counts, in
    // tests/hooks/use-infinite-reveal.test.tsx — the seeded catalogue has no
    // query matching more than six lessons, so this file cannot tell a reset
    // from a narrow result set and does not claim to.
    //
    // Scrolled rather than clicked: with the observer live, Playwright's own
    // scroll-into-view fires it and the button moves out from under the click.
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 3000);
      if ((await lessonRows(page).count()) > LESSON_PAGE) break;
    }
    const revealed = await lessonRows(page).count();
    expect(revealed).toBeGreaterThan(LESSON_PAGE);

    await search(page, "atom");

    const matches = await lessonRows(page).count();
    expect(matches).toBeGreaterThan(0);
    expect(matches).toBeLessThan(revealed);
  });

  test("says so, quoting the query, when nothing matches", async ({ page }) => {
    await page.goto("/en/lessons");
    await search(page, "zzzznotathing");

    await expect(lessonRows(page)).toHaveCount(0);
    // "No lessons found" would read as an empty catalogue. The reader needs
    // their own query back.
    await expect(page.getByText(/zzzznotathing/)).toBeVisible();
  });

  test("clearing the search brings the catalogue back", async ({ page }) => {
    await page.goto("/en/lessons");
    await search(page, "zzzznotathing");
    await expect(lessonRows(page)).toHaveCount(0);

    await page.getByRole("button", { name: /clear search/i }).click();
    await expect(lessonRows(page)).toHaveCount(LESSON_PAGE);
    await expect(page.getByRole("searchbox")).toHaveValue("");
  });

  test("Escape clears the search, as the native contract promises", async ({
    page,
  }) => {
    await page.goto("/en/lessons");
    await search(page, "zzzznotathing");
    const box = page.getByRole("searchbox");
    await box.press("Escape");
    await expect(box).toHaveValue("");
    await expect(lessonRows(page)).toHaveCount(LESSON_PAGE);
  });
});

test.describe("the quiz catalogue", () => {
  test("starts at one page and has no previous/next buttons", async ({
    page,
  }) => {
    await page.goto("/en/quiz");
    await expect(quizRows(page)).toHaveCount(QUIZ_PAGE);
    // Pagination is gone, not hidden.
    await expect(
      page.getByRole("button", { name: /next page|previous page/i }),
    ).toHaveCount(0);
  });

  test("reveals the rest as the reader scrolls", async ({ page }) => {
    await page.goto("/en/quiz");
    await expect(quizRows(page)).toHaveCount(QUIZ_PAGE);

    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 4000);
      if ((await quizRows(page).count()) > QUIZ_PAGE) break;
    }

    await expect(quizRows(page)).toHaveCount(6);
  });

  test("searching finds a quiz by its title", async ({ page }) => {
    await page.goto("/en/quiz");
    await search(page, "periodic");

    const matches = quizRows(page);
    await expect(matches).toHaveCount(1);
    await expect(matches.first()).toHaveAttribute(
      "href",
      /periodic-table-basics/,
    );
  });

  test("a row does not start a quiz — only its button does", async ({
    page,
  }) => {
    // Attempt limits and a timer sit behind Start. A whole-row link would burn
    // one because somebody tapped near a title while scrolling.
    await page.goto("/en/quiz");
    const title = page.getByRole("heading", { level: 2 }).first();
    await title.click();
    // `localePrefix` is `as-needed`, so the default locale has no prefix.
    await expect(page).toHaveURL(/\/quiz$/);
  });
});

test.describe("the Arabic catalogue", () => {
  test("searches in an RTL locale", async ({ page }) => {
    // Run last in this file because it leaves the NEXT_LOCALE cookie set to
    // Arabic. The seeded lesson titles are English — chemistry here is not
    // machine translated and the page says so — so what can be asserted
    // honestly is that the box works at all under RTL, and that a query
    // matching nothing says so rather than emptying the page in silence. The
    // Arabic folding itself is proven against Arabic content in
    // tests/lib/search-normalize.test.ts.
    await page.goto("/ar/lessons");

    const arabicRows = page.getByRole("link", {
      name: /^\u0627\u0642\u0631\u0623 \u0627\u0644\u062F\u0631\u0633:/,
    });
    await expect(arabicRows).toHaveCount(LESSON_PAGE);

    // "\u0645\u0633\u062D \u0627\u0644\u0628\u062D\u062B" — clear search.
    await search(
      page,
      "zzzznotathing",
      /\u0645\u0633\u062D \u0627\u0644\u0628\u062D\u062B/,
    );
    await expect(arabicRows).toHaveCount(0);
    await expect(page.getByText(/zzzznotathing/)).toBeVisible();

    await page.getByRole("searchbox").press("Escape");
    await expect(arabicRows).toHaveCount(LESSON_PAGE);
  });
});
