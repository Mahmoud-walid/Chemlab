import { describe, expect, it } from "vitest";

import {
  offPageCount,
  pageSelectionState,
  parseSelection,
  serialiseSelection,
  setPageSelected,
  toggleSelected,
  viewKey,
} from "@/lib/admin/selection";

describe("viewKey", () => {
  it("ignores the page, so a selection survives paging", () => {
    expect(
      viewKey("lessons", [
        ["page", "2"],
        ["q", "acid"],
      ]),
    ).toBe(
      viewKey("lessons", [
        ["page", "5"],
        ["q", "acid"],
      ]),
    );
  });

  it("changes with the filter, so a selection does not cross views", () => {
    // A selection made under "status: draft" means nothing under
    // "status: published" — carrying it over would let somebody act on rows
    // they were not looking at when they ticked them.
    expect(viewKey("lessons", [["status", "draft"]])).not.toBe(
      viewKey("lessons", [["status", "published"]]),
    );
  });

  it("is order-independent, because the two URLs are the same list", () => {
    expect(
      viewKey("lessons", [
        ["q", "acid"],
        ["status", "draft"],
      ]),
    ).toBe(
      viewKey("lessons", [
        ["status", "draft"],
        ["q", "acid"],
      ]),
    );
  });

  it("treats an empty parameter as absent", () => {
    expect(viewKey("lessons", [["q", ""]])).toBe(viewKey("lessons", []));
  });

  it("scopes to the table", () => {
    expect(viewKey("lessons", [])).not.toBe(viewKey("quizzes", []));
  });
});

describe("parseSelection", () => {
  it("reads a stored list", () => {
    expect(parseSelection('["a","b"]')).toEqual(["a", "b"]);
  });

  it("is empty for anything unreadable", () => {
    for (const stored of [null, undefined, "", "{", "null", '"a"', "5"]) {
      expect(parseSelection(stored)).toEqual([]);
    }
  });

  it("drops non-strings and duplicates", () => {
    expect(parseSelection('["a", 1, "a", null, "b"]')).toEqual(["a", "b"]);
  });

  it("round-trips", () => {
    expect(parseSelection(serialiseSelection(["a", "b"]))).toEqual(["a", "b"]);
  });
});

describe("toggleSelected", () => {
  it("adds and removes", () => {
    expect(toggleSelected([], "a")).toEqual(["a"]);
    expect(toggleSelected(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("setPageSelected", () => {
  const held = ["p1a", "p1b"];

  it("adds this page without touching the rest", () => {
    // An operator who selected two rows on page one must not lose them by
    // tidying up page two.
    expect(setPageSelected(held, ["p2a", "p2b"], true)).toEqual([
      "p1a",
      "p1b",
      "p2a",
      "p2b",
    ]);
  });

  it("removes only this page", () => {
    expect(setPageSelected([...held, "p2a"], ["p2a"], false)).toEqual(held);
  });

  it("does not duplicate a row already held", () => {
    expect(setPageSelected(held, ["p1a", "p2a"], true)).toEqual([
      "p1a",
      "p1b",
      "p2a",
    ]);
  });
});

describe("pageSelectionState", () => {
  it("distinguishes none, some and all", () => {
    expect(pageSelectionState([], ["a", "b"])).toBe("none");
    expect(pageSelectionState(["a"], ["a", "b"])).toBe("some");
    expect(pageSelectionState(["a", "b"], ["a", "b"])).toBe("all");
  });

  it("is 'none' for an empty page, not 'all'", () => {
    // `every` over an empty list is true, which would tick the header
    // checkbox on a list with nothing in it.
    expect(pageSelectionState([], [])).toBe("none");
    expect(pageSelectionState(["a"], [])).toBe("none");
  });

  it("ignores selections from other pages", () => {
    expect(pageSelectionState(["off-page", "a", "b"], ["a", "b"])).toBe("all");
  });
});

describe("offPageCount", () => {
  it("counts what the operator cannot currently see", () => {
    // The bar has to say so, or "12 selected" over a page showing three
    // ticks reads as a bug.
    expect(offPageCount(["a", "b", "c"], ["a"])).toBe(2);
    expect(offPageCount(["a"], ["a", "b"])).toBe(0);
  });
});
