import { describe, expect, it } from "vitest";
import {
  DEFAULT_SITE_DESCRIPTION,
  DEFAULT_SITE_NAME,
  DEFAULT_SITE_URL,
  absoluteUrl,
  env,
  parseEnv,
} from "@/lib/env";

describe("parseEnv defaults", () => {
  it("falls back to defaults when nothing is set", () => {
    const parsed = parseEnv({});
    expect(parsed.NEXT_PUBLIC_SITE_URL).toBe(DEFAULT_SITE_URL);
    expect(parsed.NEXT_PUBLIC_SITE_NAME).toBe(DEFAULT_SITE_NAME);
    expect(parsed.NEXT_PUBLIC_SITE_DESCRIPTION).toBe(DEFAULT_SITE_DESCRIPTION);
    expect(parsed.NEXT_PUBLIC_TWITTER_HANDLE).toBeUndefined();
  });

  it("treats an empty string as unset rather than invalid", () => {
    const parsed = parseEnv({
      NEXT_PUBLIC_SITE_URL: "",
      NEXT_PUBLIC_SITE_NAME: "",
      NEXT_PUBLIC_TWITTER_HANDLE: "",
    });
    expect(parsed.NEXT_PUBLIC_SITE_URL).toBe(DEFAULT_SITE_URL);
    expect(parsed.NEXT_PUBLIC_SITE_NAME).toBe(DEFAULT_SITE_NAME);
    expect(parsed.NEXT_PUBLIC_TWITTER_HANDLE).toBeUndefined();
  });

  it("defaults the site name to Chemlab", () => {
    expect(DEFAULT_SITE_NAME).toBe("Chemlab");
  });
});

describe("parseEnv overrides", () => {
  it("accepts valid values", () => {
    const parsed = parseEnv({
      NEXT_PUBLIC_SITE_URL: "https://chemlab.app",
      NEXT_PUBLIC_SITE_NAME: "Chemlab Staging",
      NEXT_PUBLIC_SITE_DESCRIPTION: "Chemistry, interactively.",
      NEXT_PUBLIC_TWITTER_HANDLE: "@ChemlabApp",
    });

    expect(parsed).toEqual({
      NEXT_PUBLIC_SITE_URL: "https://chemlab.app",
      NEXT_PUBLIC_SITE_NAME: "Chemlab Staging",
      NEXT_PUBLIC_SITE_DESCRIPTION: "Chemistry, interactively.",
      NEXT_PUBLIC_TWITTER_HANDLE: "@ChemlabApp",
    });
  });

  it("trims surrounding whitespace", () => {
    const parsed = parseEnv({ NEXT_PUBLIC_SITE_NAME: "  Chemlab  " });
    expect(parsed.NEXT_PUBLIC_SITE_NAME).toBe("Chemlab");
  });

  it("accepts a URL with a path or port", () => {
    expect(
      parseEnv({ NEXT_PUBLIC_SITE_URL: "http://localhost:4000" })
        .NEXT_PUBLIC_SITE_URL,
    ).toBe("http://localhost:4000");
  });
});

describe("parseEnv rejection", () => {
  it.each([["not-a-url"], ["chemlab.app"], ["/relative/path"]])(
    "rejects %s as a site URL",
    (value) => {
      expect(() => parseEnv({ NEXT_PUBLIC_SITE_URL: value })).toThrow(
        /NEXT_PUBLIC_SITE_URL/,
      );
    },
  );

  it("rejects a whitespace-only site name", () => {
    expect(() => parseEnv({ NEXT_PUBLIC_SITE_NAME: "   " })).toThrow(
      /NEXT_PUBLIC_SITE_NAME/,
    );
  });

  it.each([["ChemlabApp"], ["@"], ["@way_too_long_a_handle_here"]])(
    "rejects %s as a twitter handle",
    (value) => {
      expect(() => parseEnv({ NEXT_PUBLIC_TWITTER_HANDLE: value })).toThrow(
        /NEXT_PUBLIC_TWITTER_HANDLE/,
      );
    },
  );

  it("names every offending variable in one error", () => {
    expect(() =>
      parseEnv({
        NEXT_PUBLIC_SITE_URL: "nope",
        NEXT_PUBLIC_TWITTER_HANDLE: "nope",
      }),
    ).toThrow(/NEXT_PUBLIC_SITE_URL[\s\S]*NEXT_PUBLIC_TWITTER_HANDLE/);
  });

  it("explains what a valid value looks like", () => {
    expect(() => parseEnv({ NEXT_PUBLIC_SITE_URL: "nope" })).toThrow(
      /absolute URL/,
    );
  });
});

describe("absoluteUrl", () => {
  it("builds an absolute URL from the configured origin", () => {
    expect(absoluteUrl("/og-image.png")).toBe(
      new URL("/og-image.png", env.NEXT_PUBLIC_SITE_URL).toString(),
    );
  });

  it("defaults to the site root", () => {
    expect(absoluteUrl()).toBe(
      new URL("/", env.NEXT_PUBLIC_SITE_URL).toString(),
    );
  });
});
