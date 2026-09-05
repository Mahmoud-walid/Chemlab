import { describe, expect, it } from "vitest";

import { localizedPaths } from "@/i18n/paths";
import { defaultLocale, locales } from "@/i18n/routing";

describe("localizedPaths", () => {
  it("gives the unprefixed path to the default locale and prefixes the rest", () => {
    // `localePrefix: "as-needed"`. English is served at `/lessons/acids`, so
    // revalidating `/en/lessons/acids` would refresh a URL nobody visits.
    expect(localizedPaths("/lessons/acids")).toEqual([
      "/lessons/acids",
      "/ar/lessons/acids",
    ]);
  });

  it("covers every configured locale, so adding one cannot be forgotten", () => {
    const paths = localizedPaths("/x");
    expect(paths).toHaveLength(locales.length);
    expect(paths).toContain("/x");
    for (const locale of locales.filter((l) => l !== defaultLocale)) {
      expect(paths).toContain(`/${locale}/x`);
    }
  });
});
