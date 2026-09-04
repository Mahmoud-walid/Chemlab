import { describe, expect, it } from "vitest";
import {
  defaultLocale,
  direction,
  isRtl,
  isSupportedLocale,
  locales,
  resolveLocale,
  routing,
} from "@/i18n/routing";

describe("routing", () => {
  it("serves English on the existing unprefixed URLs", () => {
    // localePrefix "as-needed" is what keeps /lessons working and indexed.
    expect(routing.localePrefix).toBe("as-needed");
    expect(defaultLocale).toBe("en");
  });

  it("supports English and Arabic", () => {
    expect([...locales].sort()).toEqual(["ar", "en"]);
    expect(routing.locales).toEqual(locales);
  });

  it("persists the choice in a long-lived NEXT_LOCALE cookie", () => {
    const cookie = routing.localeCookie;
    expect(cookie).toBeTruthy();
    expect(typeof cookie === "object" && cookie.name).toBe("NEXT_LOCALE");
  });
});

describe("direction", () => {
  it("marks Arabic as right-to-left", () => {
    expect(isRtl("ar")).toBe(true);
    expect(direction("ar")).toBe("rtl");
  });

  it("marks English as left-to-right", () => {
    expect(isRtl("en")).toBe(false);
    expect(direction("en")).toBe("ltr");
  });

  it("treats an unknown locale as left-to-right rather than throwing", () => {
    expect(direction("fr")).toBe("ltr");
  });
});

describe("resolveLocale", () => {
  it("keeps a supported locale", () => {
    expect(resolveLocale("ar")).toBe("ar");
    expect(resolveLocale("en")).toBe("en");
  });

  it("falls back when the segment is missing", () => {
    // Pages outside the [locale] segment render with no locale at all.
    expect(resolveLocale(undefined)).toBe(defaultLocale);
  });

  it.each(["fr", "de", "unknown.txt", "", "AR", "ar-EG", "../etc/passwd"])(
    "falls back for %o rather than throwing",
    (requested) => {
      // The [locale] segment is a catch-all, so anything can arrive here.
      expect(resolveLocale(requested)).toBe(defaultLocale);
    },
  );
});

describe("isSupportedLocale", () => {
  it("accepts configured locales only", () => {
    expect(isSupportedLocale("en")).toBe(true);
    expect(isSupportedLocale("ar")).toBe(true);
    expect(isSupportedLocale("fr")).toBe(false);
  });

  it("rejects non-strings without throwing", () => {
    for (const value of [undefined, null, 42, {}, [], true]) {
      expect(isSupportedLocale(value)).toBe(false);
    }
  });
});
