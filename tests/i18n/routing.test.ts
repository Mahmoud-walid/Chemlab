import { describe, expect, it } from "vitest";
import {
  defaultLocale,
  direction,
  isRtl,
  locales,
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
