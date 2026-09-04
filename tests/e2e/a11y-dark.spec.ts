import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Contrast is theme-specific: a palette that passes in light can fail in dark
 * and vice versa, because the tint each colour sits on inverts. The app uses
 * next-themes with `defaultTheme="system"`, so emulating the OS preference is
 * enough to exercise the dark tokens.
 */
test.use({ colorScheme: "dark" });

const KNOWN_VIOLATIONS: string[] = [];

for (const path of ["/", "/quiz", "/lessons"]) {
  test(`${path} has no accessibility violations in dark mode`, async ({
    page,
  }) => {
    await page.goto(path);
    await expect(page.locator("html")).toHaveClass(/dark/);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    const unexpected = results.violations
      .filter((v) => !KNOWN_VIOLATIONS.includes(v.id))
      .map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`);

    expect(unexpected, "dark-mode axe violations").toEqual([]);
  });
}
