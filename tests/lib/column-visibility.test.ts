import { describe, expect, it, vi } from "vitest";

import {
  isLocked,
  parseHidden,
  readRaw,
  serialiseHidden,
  toggleHidden,
  visibilityKey,
  writeRaw,
  type ColumnSpec,
} from "@/lib/admin/column-visibility";

const COLUMNS: ColumnSpec[] = [
  { id: "position" },
  { id: "title", link: true },
  { id: "category" },
  { id: "status", required: true },
  { id: "updated" },
];

describe("what may be hidden", () => {
  it("locks the link column and anything marked required", () => {
    expect(isLocked({ id: "title", link: true })).toBe(true);
    expect(isLocked({ id: "status", required: true })).toBe(true);
    expect(isLocked({ id: "updated" })).toBe(false);
  });

  it("refuses to hide a locked column even when asked directly", () => {
    // The link column is the only way into the row's editor. Hiding it leaves
    // a table that looks fine and cannot be used.
    expect(toggleHidden(new Set(), COLUMNS[1]!)).toEqual(new Set());
    expect(toggleHidden(new Set(), COLUMNS[3]!)).toEqual(new Set());
  });

  it("toggles an ordinary column both ways", () => {
    const hidden = toggleHidden(new Set(), COLUMNS[4]!);
    expect(hidden).toEqual(new Set(["updated"]));
    expect(toggleHidden(hidden, COLUMNS[4]!)).toEqual(new Set());
  });
});

describe("parseHidden", () => {
  it("reads a stored list", () => {
    expect(parseHidden('["updated","category"]', COLUMNS)).toEqual(
      new Set(["updated", "category"]),
    );
  });

  it("shows every column when there is nothing stored", () => {
    for (const stored of [null, undefined, ""]) {
      expect(parseHidden(stored, COLUMNS)).toEqual(new Set());
    }
  });

  it("shows every column when the stored value is not usable", () => {
    // An empty table is a far worse failure than a forgotten preference.
    for (const stored of ["{", "null", '"updated"', "42", '{"a":1}']) {
      expect(parseHidden(stored, COLUMNS)).toEqual(new Set());
    }
  });

  it("drops ids the table no longer has", () => {
    // A column removed and later re-added under the same id would otherwise
    // come back hidden, which reads as the new column not working.
    expect(parseHidden('["gone","updated"]', COLUMNS)).toEqual(
      new Set(["updated"]),
    );
  });

  it("refuses a stored entry that would hide the link column", () => {
    // Enforced on read as well as on write: an entry written before a column
    // became the link column must not be able to hide the way into the row.
    expect(parseHidden('["title","status","updated"]', COLUMNS)).toEqual(
      new Set(["updated"]),
    );
  });

  it("ignores non-string entries", () => {
    expect(parseHidden('["updated", 3, null]', COLUMNS)).toEqual(
      new Set(["updated"]),
    );
  });
});

describe("serialiseHidden", () => {
  it("sorts, so an unchanged set writes an equal string", () => {
    expect(serialiseHidden(new Set(["updated", "category"]))).toBe(
      serialiseHidden(new Set(["category", "updated"])),
    );
  });

  it("round-trips", () => {
    const hidden = new Set(["category", "updated"]);
    expect(parseHidden(serialiseHidden(hidden), COLUMNS)).toEqual(hidden);
  });
});

describe("storage that misbehaves", () => {
  it("reads as empty when getItem throws", () => {
    // Private browsing and blocked site data make the accessor itself throw.
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("denied");
      }),
    };
    expect(readRaw(visibilityKey("lessons"), storage)).toBe("");
    // And empty parses to "nothing hidden", so the whole table shows.
    expect(parseHidden("", COLUMNS)).toEqual(new Set());
  });

  it("reads as empty when there is no storage at all", () => {
    expect(readRaw(visibilityKey("lessons"), undefined)).toBe("");
  });

  it("says nothing when setItem throws", () => {
    const storage = {
      setItem: vi.fn(() => {
        throw new Error("quota");
      }),
    };
    // Losing a preference is not an error worth showing anybody.
    expect(() =>
      writeRaw(visibilityKey("lessons"), '["updated"]', storage),
    ).not.toThrow();
  });

  it("scopes the key to one table", () => {
    // Two tables must not share a preference.
    expect(visibilityKey("lessons")).not.toBe(visibilityKey("quizzes"));
    expect(visibilityKey("lessons")).toContain("lessons");
  });
});
