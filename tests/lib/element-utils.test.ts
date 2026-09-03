import { describe, expect, it } from "vitest";
import {
  CATEGORY_LABELS,
  CATEGORY_STYLES,
  getCategoryStyle,
} from "@/lib/element-utils";

const FALLBACK = {
  bg: "bg-muted",
  text: "text-muted-foreground",
  border: "border-border",
};

describe("getCategoryStyle", () => {
  it("returns the mapped style for a known category", () => {
    expect(getCategoryStyle("noble gas")).toEqual(CATEGORY_STYLES["noble gas"]);
  });

  it("is case-insensitive", () => {
    expect(getCategoryStyle("Noble Gas")).toEqual(
      getCategoryStyle("noble gas"),
    );
    expect(getCategoryStyle("ALKALI METAL")).toEqual(
      CATEGORY_STYLES["alkali metal"],
    );
  });

  it("falls back to muted styling for unknown categories", () => {
    expect(getCategoryStyle("unknown, probably metalloid")).toEqual(FALLBACK);
    expect(getCategoryStyle("")).toEqual(FALLBACK);
  });

  it("returns bg/text/border for every known category", () => {
    for (const category of Object.keys(CATEGORY_STYLES)) {
      const style = getCategoryStyle(category);
      expect(style.bg).toMatch(/^bg-/);
      expect(style.text).toMatch(/^text-/);
      expect(style.border).toMatch(/^border-/);
    }
  });
});

describe("CATEGORY_STYLES / CATEGORY_LABELS", () => {
  it("uses lowercase keys so lookups by lowercased category succeed", () => {
    for (const key of [
      ...Object.keys(CATEGORY_STYLES),
      ...Object.keys(CATEGORY_LABELS),
    ]) {
      expect(key).toBe(key.toLowerCase());
    }
  });

  it("labels and styles cover the same categories", () => {
    expect(Object.keys(CATEGORY_LABELS).sort()).toEqual(
      Object.keys(CATEGORY_STYLES).sort(),
    );
  });

  it("gives every category a human-readable label", () => {
    for (const [key, label] of Object.entries(CATEGORY_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
      expect(label.toLowerCase().replace(/-/g, " ")).toBe(
        key.replace(/-/g, " "),
      );
    }
  });
});
