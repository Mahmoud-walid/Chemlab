import { describe, expect, it } from "vitest";

import {
  anchorFor,
  blocksSchema,
  blocksToText,
  isAllowedMediaUrl,
  isSafeHref,
  parseBlocks,
  tableOfContents,
  type LessonBlock,
} from "@/lib/lessons/blocks";

/**
 * The block model. Two things are being checked: that the write path refuses
 * what the renderer must never see, and that the read path degrades rather
 * than blanking a lesson when a row predates a schema change.
 */

const paragraph = (id: string, text: string): LessonBlock => ({
  id,
  type: "paragraph",
  text: [{ text }],
});

describe("the write path", () => {
  it("accepts a well-formed body", () => {
    const result = blocksSchema.safeParse([
      paragraph("a", "Chemistry is the study of matter."),
      { id: "b", type: "heading", level: 2, text: "States", anchor: "states" },
      { id: "c", type: "divider" },
    ]);
    expect(result.success).toBe(true);
  });

  it("rejects a block type nobody has written a renderer for", () => {
    // The closed union is the whole security argument: an unknown type cannot
    // be stored, so no unrenderable shape reaches the page.
    expect(blocksSchema.safeParse([{ id: "a", type: "iframe" }]).success).toBe(
      false,
    );
  });

  it("rejects a heading level the document outline cannot carry", () => {
    // The page's h1 is the lesson title. A level-1 heading in the body would
    // give the document two top-level headings.
    const bad = { id: "a", type: "heading", level: 1, text: "x", anchor: "x" };
    expect(blocksSchema.safeParse([bad]).success).toBe(false);
  });

  it.each(["javascript:alert(1)", "data:text/html,<script>", "vbscript:x"])(
    "rejects %s as a link href",
    (href) => {
      const block = {
        id: "a",
        type: "paragraph",
        text: [{ text: "click", href }],
      };
      expect(blocksSchema.safeParse([block]).success).toBe(false);
    },
  );

  it("accepts an ordinary https link", () => {
    const block = {
      id: "a",
      type: "paragraph",
      text: [{ text: "docs", href: "https://example.org/a" }],
    };
    expect(blocksSchema.safeParse([block]).success).toBe(true);
  });

  it("rejects media from a host nobody configured", () => {
    const block = {
      id: "a",
      type: "image",
      url: "https://evil.example/x.png",
      alt: "",
    };
    expect(blocksSchema.safeParse([block]).success).toBe(false);
  });

  it("accepts media from the configured delivery host", () => {
    const block = {
      id: "a",
      type: "image",
      url: "https://res.cloudinary.com/demo/image/upload/x.png",
      alt: "A flask",
    };
    expect(blocksSchema.safeParse([block]).success).toBe(true);
  });

  it("requires alt text to be present, even when empty", () => {
    // `alt: ""` is an author saying the image is decorative. An absent alt is
    // an oversight, and a screen reader treats the two differently.
    const noAlt = {
      id: "a",
      type: "image",
      url: "https://res.cloudinary.com/demo/image/upload/x.png",
    };
    expect(blocksSchema.safeParse([noAlt]).success).toBe(false);
  });
});

describe("isSafeHref", () => {
  it("allows http and https only", () => {
    expect(isSafeHref("https://a.example")).toBe(true);
    expect(isSafeHref("http://a.example")).toBe(true);
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref("not a url")).toBe(false);
  });
});

describe("isAllowedMediaUrl", () => {
  it("refuses http even on an allowed host", () => {
    // An http image on an https page is blocked as mixed content by every
    // browser, so storing one stores a URL that cannot render.
    expect(
      isAllowedMediaUrl("http://res.cloudinary.com/x.png", [
        "res.cloudinary.com",
      ]),
    ).toBe(false);
  });

  it("is not fooled by a lookalike host", () => {
    expect(
      isAllowedMediaUrl("https://res.cloudinary.com.evil.test/x.png", [
        "res.cloudinary.com",
      ]),
    ).toBe(false);
  });

  it("accepts nothing when no host is configured", () => {
    expect(isAllowedMediaUrl("https://anything.test/x.png", [])).toBe(false);
  });
});

describe("the read path", () => {
  it("drops a block it cannot render instead of blanking the lesson", () => {
    // A row written before a schema change is already in the table. Refusing
    // to render the article because one block gained a field would be a blank
    // page where there was a lesson.
    const blocks = parseBlocks([
      paragraph("a", "Kept."),
      { id: "b", type: "hologram" },
      paragraph("c", "Also kept."),
    ]);
    expect(blocks.map((block) => block.id)).toEqual(["a", "c"]);
  });

  it("returns nothing for a body that is not an array at all", () => {
    expect(parseBlocks({ type: "doc", content: [] })).toEqual([]);
    expect(parseBlocks(null)).toEqual([]);
  });
});

describe("tableOfContents", () => {
  it("takes only the headings, in order", () => {
    const toc = tableOfContents([
      paragraph("a", "x"),
      { id: "b", type: "heading", level: 2, text: "One", anchor: "one" },
      paragraph("c", "y"),
      { id: "d", type: "heading", level: 3, text: "Two", anchor: "two" },
    ]);
    expect(toc.map((entry) => entry.anchor)).toEqual(["one", "two"]);
    expect(toc[1]!.level).toBe(3);
  });
});

describe("blocksToText", () => {
  it("reads prose, headings, lists and captions", () => {
    const text = blocksToText([
      { id: "a", type: "heading", level: 2, text: "Title", anchor: "t" },
      paragraph("b", "Body."),
      { id: "c", type: "list", ordered: false, items: [[{ text: "One" }]] },
    ]);
    expect(text).toContain("Title");
    expect(text).toContain("Body.");
    expect(text).toContain("One");
  });

  it("leaves alt text out", () => {
    // Alt text describes an image; counting it as prose would inflate the
    // reading time for sighted and unsighted readers alike.
    const text = blocksToText([
      {
        id: "a",
        type: "image",
        url: "https://res.cloudinary.com/demo/image/upload/x.png",
        alt: "A very long description of a flask",
        caption: "Figure 1",
      },
    ]);
    expect(text).toBe("Figure 1");
  });
});

describe("anchorFor", () => {
  it("slugs a heading", () => {
    expect(anchorFor("States of Matter", "x")).toBe("states-of-matter");
  });

  it("keeps Arabic letters rather than emptying the slug", () => {
    expect(anchorFor("حالات المادة", "x")).toBe("حالات-المادة");
  });

  it("falls back when a heading has nothing sluggable in it", () => {
    expect(anchorFor("!!!", "section-3")).toBe("section-3");
  });
});
