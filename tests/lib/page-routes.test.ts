import { describe, expect, it } from "vitest";

import {
  ALWAYS_OPEN,
  CLOSABLE_ROUTES,
  covers,
  isAlwaysOpen,
  routeKeyFor,
  withoutLocale,
} from "@/lib/pages/routes";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";

describe("the closable route list", () => {
  it("has a unique key per route", () => {
    const keys = CLOSABLE_ROUTES.map((route) => route.routeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("names a title that resolves in both catalogues", () => {
    for (const route of CLOSABLE_ROUTES) {
      expect(
        en.pages.titles[route.titleKey as keyof typeof en.pages.titles],
        `en: ${route.titleKey}`,
      ).toBeTruthy();
      expect(
        ar.pages.titles[route.titleKey as keyof typeof ar.pages.titles],
        `ar: ${route.titleKey}`,
      ).toBeTruthy();
    }
  });

  it("never lists a route that can never be closed", () => {
    // A row for /admin would be a switch that closes the page which reopens it.
    for (const route of CLOSABLE_ROUTES) {
      expect(isAlwaysOpen(route.routeKey), route.routeKey).toBe(false);
    }
  });
});

describe("withoutLocale", () => {
  it.each([
    ["/en/lessons", "/lessons"],
    ["/ar/lessons", "/lessons"],
    ["/lessons", "/lessons"],
    ["/en", "/"],
    ["/ar", "/"],
    ["/", "/"],
  ])("maps %j to %j", (input, expected) => {
    expect(withoutLocale(input)).toBe(expected);
  });

  it("does not strip a segment that merely starts with a locale name", () => {
    // "/english" is not "/en" + "glish".
    expect(withoutLocale("/english")).toBe("/english");
    expect(withoutLocale("/article")).toBe("/article");
  });
});

describe("covers", () => {
  it("includes children", () => {
    expect(covers("/lessons", "/lessons")).toBe(true);
    expect(covers("/lessons", "/lessons/acids-bases-ph")).toBe(true);
  });

  it("does not match a sibling that shares a prefix", () => {
    // "/games" must not swallow "/gameshow".
    expect(covers("/games", "/gameshow")).toBe(false);
  });

  it("treats the home route as the home page only", () => {
    // "/" prefix-matches everything; taking the whole site down is not a page
    // switch, and would make every other row unreachable.
    expect(covers("/", "/")).toBe(true);
    expect(covers("/", "/lessons")).toBe(false);
  });
});

describe("routeKeyFor", () => {
  it.each([
    ["/", "/"],
    ["/lessons", "/lessons"],
    ["/lessons/acids-bases-ph", "/lessons"],
    ["/quiz", "/quiz"],
    ["/quiz/acids-and-bases", "/quiz"],
    ["/chemical/iron", "/chemical"],
    ["/games", "/games"],
  ])("maps %j to %j", (pathname, expected) => {
    expect(routeKeyFor(pathname)).toBe(expected);
  });

  it("prefers the longest match, so a child can override its parent", () => {
    // Closing /quiz must not make /quiz/results' own row decoration.
    expect(routeKeyFor("/quiz/results")).toBe("/quiz/results");
  });

  it("is locale-independent", () => {
    expect(routeKeyFor("/ar/lessons/acids-bases-ph")).toBe("/lessons");
    expect(routeKeyFor("/en/quiz/results")).toBe("/quiz/results");
  });

  it("returns null for a path no key covers", () => {
    // An unknown path is a 404's problem, not the switch's.
    expect(routeKeyFor("/nonsense")).toBeNull();
    expect(routeKeyFor("/admin/lessons")).toBeNull();
  });

  it("accepts a caller-supplied key list, so the DB is the source of truth", () => {
    expect(routeKeyFor("/lessons/x", ["/lessons"])).toBe("/lessons");
    expect(routeKeyFor("/lessons/x", ["/quiz"])).toBeNull();
  });
});

describe("isAlwaysOpen", () => {
  it.each([
    "/admin",
    "/admin/lessons",
    "/sign-in",
    "/sign-up",
    "/profile",
    "/profile/saved",
  ])("protects %j", (pathname) => {
    expect(isAlwaysOpen(pathname)).toBe(true);
  });

  it.each(["/", "/lessons", "/quiz", "/games", "/chemical/iron"])(
    "leaves %j closable",
    (pathname) => {
      expect(isAlwaysOpen(pathname)).toBe(false);
    },
  );

  it("is locale-independent", () => {
    expect(isAlwaysOpen("/ar/admin")).toBe(true);
    expect(isAlwaysOpen("/en/sign-in")).toBe(true);
  });

  it("covers every route in the list", () => {
    for (const prefix of ALWAYS_OPEN) {
      expect(isAlwaysOpen(prefix), prefix).toBe(true);
      expect(isAlwaysOpen(`${prefix}/deeper`), prefix).toBe(true);
    }
  });
});
