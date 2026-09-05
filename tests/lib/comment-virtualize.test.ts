import { describe, expect, it } from "vitest";

import {
  VIRTUALIZE_ABOVE,
  commentIdFromHash,
  indexOfComment,
  renderedNodes,
  shouldVirtualize,
} from "@/lib/comments/virtualize";

/**
 * Windowing costs find-in-page, anchor links, print and part of the
 * accessibility tree. The threshold is what keeps almost every lesson from
 * paying any of it, so where it sits is worth asserting.
 */

const root = (replies = 0) => ({ replies: Array.from({ length: replies }) });

describe("counting what costs layout", () => {
  it("counts rendered nodes, not top-level comments", () => {
    // One root with forty replies is forty-one rows to lay out. Counting
    // roots would call that "one" and never virtualize the thread that most
    // needs it.
    expect(renderedNodes([root(40)])).toBe(41);
    expect(renderedNodes([root(), root(), root()])).toBe(3);
  });

  it("treats a root with no replies field as one node", () => {
    expect(renderedNodes([{}, {}])).toBe(2);
  });
});

describe("the threshold", () => {
  it("leaves an ordinary discussion as plain DOM", () => {
    // Which is the case for almost every lesson, and it is the branch with no
    // broken find-in-page and no broken anchors.
    const ordinary = Array.from({ length: 12 }, () => root(2));
    expect(shouldVirtualize(ordinary)).toBe(false);
  });

  it("turns on past the boundary, not at it", () => {
    const exactly = Array.from({ length: VIRTUALIZE_ABOVE }, () => root());
    expect(shouldVirtualize(exactly)).toBe(false);
    expect(shouldVirtualize([...exactly, root()])).toBe(true);
  });

  it("counts replies toward it", () => {
    // Fifty roots is comfortably under; fifty roots each with two replies is
    // a hundred and fifty rows and comfortably over.
    const roots = Array.from({ length: 50 }, () => root(2));
    expect(renderedNodes(roots)).toBe(150);
    expect(shouldVirtualize(roots)).toBe(true);
  });
});

describe("deep links", () => {
  it("finds a comment that is loaded", () => {
    expect(indexOfComment([{ id: "a" }, { id: "b" }], "b")).toBe(1);
  });

  it("says so when the target is not loaded yet", () => {
    // Null, so the caller fetches more pages first. Scrolling to an index that
    // does not exist silently does nothing, which reads as a broken link.
    expect(indexOfComment([{ id: "a" }], "z")).toBeNull();
  });

  it("parses only a fragment that names a comment", () => {
    // The fragment is user input and ends up in a selector.
    expect(commentIdFromHash("#comment-01ab-CD_9")).toBe("01ab-CD_9");
    expect(commentIdFromHash("#section-2")).toBeNull();
    expect(commentIdFromHash("")).toBeNull();
    expect(commentIdFromHash("#comment-")).toBeNull();
    expect(commentIdFromHash('#comment-"]:has(script)')).toBeNull();
  });
});
