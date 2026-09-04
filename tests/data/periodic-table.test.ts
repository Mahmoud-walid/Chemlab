/**
 * Fast lane: the seed INPUT.
 *
 * The database is what the pages read, and `tests/integration/content.test.ts`
 * asserts against it. These tests stay because a malformed `data/*.json` should
 * fail in the unit project in seconds, before a seed run has to prove it.
 */
import { describe, expect, it } from "vitest";
import elements from "@/data/periodic-table-detailed.json";
import { getCategoryStyle } from "@/lib/element-utils";
import type { Element } from "@/types/element";

const data = elements as unknown as Element[];

describe("data/periodic-table-detailed.json", () => {
  it("contains at least the 118 confirmed elements", () => {
    expect(data.length).toBeGreaterThanOrEqual(118);
  });

  it("is ordered by atomic number, starting at hydrogen with no gaps", () => {
    expect(data[0].symbol).toBe("H");
    data.forEach((element, index) => {
      expect(element.number).toBe(index + 1);
    });
  });

  it("has unique names and symbols", () => {
    expect(new Set(data.map((e) => e.name)).size).toBe(data.length);
    expect(new Set(data.map((e) => e.symbol)).size).toBe(data.length);
  });

  it.each(data.map((e) => [e.symbol, e] as const))(
    "%s has renderable core fields",
    (_symbol, element) => {
      expect(element.name.trim()).not.toBe("");
      expect(element.symbol).toMatch(/^[A-Z][a-z]{0,2}$/);
      expect(element.atomic_mass).toBeGreaterThan(0);
      expect(element.category.trim()).not.toBe("");
      expect(element.shells.length).toBeGreaterThan(0);
      expect(element.shells.every((s) => s > 0)).toBe(true);
    },
  );

  it("places every element on the 18x10 periodic-table grid", () => {
    for (const element of data) {
      expect(element.xpos).toBeGreaterThanOrEqual(1);
      expect(element.xpos).toBeLessThanOrEqual(18);
      expect(element.ypos).toBeGreaterThanOrEqual(1);
      expect(element.ypos).toBeLessThanOrEqual(10);
      expect(element.period).toBeGreaterThanOrEqual(1);
    }
  });

  it("gives every element a distinct grid cell", () => {
    const cells = data.map((e) => `${e.xpos}:${e.ypos}`);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it("resolves a style for every element category", () => {
    for (const element of data) {
      const style = getCategoryStyle(element.category);
      expect(style.bg).toMatch(/^bg-/);
      expect(style.text).toMatch(/^text-/);
      expect(style.border).toMatch(/^border-/);
    }
  });

  it("keeps the shell electron count consistent with the atomic number", () => {
    for (const element of data) {
      const total = element.shells.reduce((sum, n) => sum + n, 0);
      expect(total, `${element.name} shells`).toBe(element.number);
    }
  });
});
