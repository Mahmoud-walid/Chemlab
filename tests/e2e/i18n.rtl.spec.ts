import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The browser assertions issue #15 could not make without a browser runner.
 * Runs under the `chromium-rtl` project (Arabic locale, Accept-Language: ar).
 */
test.describe("Arabic locale", () => {
  test("serves Arabic right-to-left", async ({ page }) => {
    await page.goto("/ar");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("lang", "ar");
    await expect(html).toHaveAttribute("dir", "rtl");
    // The English side is asserted in i18n.spec.ts, under the English project:
    // this one sends Accept-Language: ar, so "/" redirects to "/ar" and there
    // is no English page to assert against here.
  });

  test("follows Accept-Language for a reader who has not chosen", async ({
    page,
  }) => {
    // This project sends Accept-Language: ar.
    await page.goto("/");
    await expect(page).toHaveURL(/\/ar$/);
  });

  test("keeps the periodic table in canonical group order", async ({
    page,
  }) => {
    // Group 1 -> 18 left to right is fixed convention in Arabic chemistry
    // teaching too, so the grid must not mirror even though the page does.
    await page.goto("/ar");

    const grid = page.locator('[dir="ltr"]').first();
    await expect(grid).toBeVisible();

    const hydrogen = page.getByText("H", { exact: true }).first();
    const helium = page.getByText("He", { exact: true }).first();
    const hBox = await hydrogen.boundingBox();
    const heBox = await helium.boundingBox();

    expect(hBox, "hydrogen should render").not.toBeNull();
    expect(heBox, "helium should render").not.toBeNull();
    // Hydrogen (group 1) stays left of helium (group 18) on an RTL page.
    expect(hBox!.x).toBeLessThan(heBox!.x);
  });

  test("renders Arabic navigation, not English", async ({ page }) => {
    await page.goto("/ar");
    await expect(page.getByRole("navigation").first()).toContainText(
      /الرئيسية|الدروس|الاختبارات/,
    );
  });

  /**
   * Known, tracked violation. Pinned by id rather than disabled, so a NEW
   * violation still fails the suite.
   *
   * color-contrast: periodic table cells and difficulty badges use a chart
   * token as text on a tint of itself — 107 nodes, issue #33.
   */
  const KNOWN_VIOLATIONS: string[] = [];

  test("the reading-progress bar fills from the inline start", async ({
    page,
  }) => {
    // `scaleX` with a left origin fills from the wrong side under RTL — a
    // progress bar that empties as an Arabic reader advances. There is no
    // logical keyword for `transform-origin`, so the side is a CSS variant
    // and this is the assertion that it is wired the right way round.
    await page.goto("/ar/lessons/introduction-basics");

    const bar = page.getByRole("progressbar");
    await expect(bar).toBeAttached();

    const origin = await bar
      .locator("div")
      .first()
      .evaluate((node) => getComputedStyle(node).transformOrigin);
    // "<x> <y>" in pixels: an x at the element's own width is its right edge.
    const [x] = origin.split(" ").map(Number.parseFloat);
    const width = await bar
      .locator("div")
      .first()
      .evaluate((node) => node.getBoundingClientRect().width);
    expect(x).toBeGreaterThan(width / 2);
  });

  test("an Arabic reader gets the untranslated-body notice", async ({
    page,
  }) => {
    // The lesson bodies are English chemistry source material. Serving them
    // unannounced would let an Arabic reader take an unreviewed page for a
    // translated one.
    await page.goto("/ar/lessons/introduction-basics");
    await expect(page.getByRole("note").first()).toBeVisible();
  });

  test("the Arabic home page has no violations beyond the tracked ones", async ({
    page,
  }) => {
    await page.goto("/ar");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    const unexpected = results.violations
      .filter((v) => !KNOWN_VIOLATIONS.includes(v.id))
      .map((v) => `${v.id}: ${v.help}`);

    expect(unexpected, "new axe violations").toEqual([]);
  });
});
