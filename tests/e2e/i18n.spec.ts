import { expect, test } from "@playwright/test";

/** The English side of the locale assertions — runs under the default project. */
test.describe("English locale", () => {
  test("serves English left-to-right on the unprefixed URLs", async ({
    page,
  }) => {
    await page.goto("/");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("lang", "en");
    await expect(html).toHaveAttribute("dir", "ltr");
  });

  test("keeps the existing URLs unprefixed, so published links still work", async ({
    page,
  }) => {
    await page.goto("/lessons");
    await expect(page).toHaveURL(/\/lessons$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("404s on an unsupported locale rather than guessing", async ({
    page,
  }) => {
    const response = await page.goto("/fr");
    expect(response?.status()).toBe(404);
  });

  test("offers both locales to search engines", async ({ page }) => {
    await page.goto("/");
    for (const hreflang of ["en", "ar", "x-default"]) {
      await expect(
        page.locator(`link[rel="alternate"][hreflang="${hreflang}"]`),
      ).toHaveCount(1);
    }
  });
});
