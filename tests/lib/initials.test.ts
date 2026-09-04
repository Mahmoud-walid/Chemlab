import { describe, expect, it } from "vitest";

import { initialsOf } from "@/lib/initials";

describe("initialsOf", () => {
  it("takes the first and last initial", () => {
    expect(initialsOf("Ada Lovelace")).toBe("AL");
    expect(initialsOf("Marie Skłodowska Curie")).toBe("MC");
  });

  it("handles a single word", () => {
    expect(initialsOf("Ada")).toBe("A");
  });

  it("ignores surrounding and repeated whitespace", () => {
    expect(initialsOf("  Ada   Lovelace  ")).toBe("AL");
  });

  it("works in Arabic, taking letters from the name itself", () => {
    expect(initialsOf("مريم كوري")).toBe("مك");
  });

  it("does not split a character into half a surrogate pair", () => {
    // charAt would return a lone surrogate here and render as a replacement
    // glyph in the avatar.
    expect(initialsOf("🧪 Lab")).toBe("🧪L");
  });

  it("falls back rather than rendering an empty circle", () => {
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("   ")).toBe("?");
  });
});
