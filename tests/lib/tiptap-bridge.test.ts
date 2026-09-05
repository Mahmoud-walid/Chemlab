import { describe, expect, it } from "vitest";

import { blocksSchema, type LessonBlock } from "@/lib/lessons/blocks";
import {
  fromBlocks,
  toBlocks,
  type ProseMirrorDoc,
} from "@/lib/lessons/tiptap-bridge";

/**
 * The bridge between the editor's document and our blocks.
 *
 * #20's acceptance criterion is `toBlocks(fromBlocks(x)) === x` for every
 * block type, and that is what the first test is: one case per member of the
 * union, driven from a list, so adding a block type without a round-trip case
 * fails here rather than silently losing content the first time somebody
 * saves.
 */

const never = (): string => {
  throw new Error("Round-tripped blocks must keep their own ids");
};

const IMAGE = "https://res.cloudinary.com/demo/image/upload/x.png";
const VIDEO = "https://res.cloudinary.com/demo/video/upload/x.mp4";

const EVERY_BLOCK: LessonBlock[] = [
  {
    id: "b-paragraph",
    type: "paragraph",
    text: [
      { text: "Plain, " },
      { text: "bold", marks: ["bold"] },
      { text: " and a ", marks: ["italic", "underline"] },
      { text: "link", href: "https://example.org/a" },
    ],
  },
  { id: "b-h2", type: "heading", level: 2, text: "States", anchor: "states" },
  { id: "b-h3", type: "heading", level: 3, text: "Solids", anchor: "solids" },
  {
    id: "b-list",
    type: "list",
    ordered: false,
    items: [[{ text: "One" }], [{ text: "Two", marks: ["bold"] }]],
  },
  {
    id: "b-ordered",
    type: "list",
    ordered: true,
    items: [[{ text: "First" }]],
  },
  {
    id: "b-quote",
    type: "quote",
    text: [{ text: "Nothing is lost." }],
    attribution: "Lavoisier",
  },
  { id: "b-code", type: "code", language: "python", code: "print('hi')\n" },
  {
    id: "b-callout",
    type: "callout",
    variant: "safety",
    text: [{ text: "Wear goggles." }],
  },
  {
    id: "b-image",
    type: "image",
    url: IMAGE,
    alt: "A flask",
    caption: "Figure 1",
  },
  {
    id: "b-video",
    type: "video",
    url: VIDEO,
    caption: "A titration",
    posterUrl: IMAGE,
    durationSeconds: 90,
  },
  { id: "b-equation", type: "equation", latex: "2H_2 + O_2 -> 2H_2O" },
  { id: "b-divider", type: "divider" },
];

describe("round trip", () => {
  it("covers every block type the union defines", () => {
    // The list above must not fall behind the schema: a new block type with no
    // case here would round-trip untested and lose content on the first save.
    const covered = new Set(EVERY_BLOCK.map((block) => block.type));
    expect([...covered].sort()).toEqual(
      [
        "callout",
        "code",
        "divider",
        "equation",
        "heading",
        "image",
        "list",
        "paragraph",
        "quote",
        "video",
      ].sort(),
    );
  });

  it.each(EVERY_BLOCK.map((block) => [block.type, block] as const))(
    "%s survives a trip through the editor document",
    (_type, block) => {
      expect(toBlocks(fromBlocks([block]), never)).toEqual([block]);
    },
  );

  it("round-trips the whole document at once, in order", () => {
    const back = toBlocks(fromBlocks(EVERY_BLOCK), never);
    expect(back).toEqual(EVERY_BLOCK);
  });

  it("produces blocks the schema still accepts", () => {
    // A bridge that round-trips into something the write path would reject is
    // a bridge that fails on save rather than in a test.
    const back = toBlocks(fromBlocks(EVERY_BLOCK), never);
    expect(blocksSchema.safeParse(back).success).toBe(true);
  });

  it("keeps each block's id, so its translation stays attached", () => {
    const back = toBlocks(fromBlocks(EVERY_BLOCK), never);
    expect(back.map((block) => block.id)).toEqual(
      EVERY_BLOCK.map((block) => block.id),
    );
  });
});

describe("toBlocks", () => {
  const doc = (content: ProseMirrorDoc["content"]): ProseMirrorDoc => ({
    type: "doc",
    content,
  });

  it("gives a brand-new node an id from the caller", () => {
    const blocks = toBlocks(
      doc([{ type: "paragraph", content: [{ type: "text", text: "New." }] }]),
      (index) => `fresh-${index}`,
    );
    expect(blocks[0]!.id).toBe("fresh-0");
  });

  it("drops a node the block model cannot express", () => {
    // A table pasted from a document. Smuggling it through as a paragraph of
    // run-on text would look intentional and read as nonsense.
    const blocks = toBlocks(
      doc([
        { type: "paragraph", content: [{ type: "text", text: "Kept." }] },
        { type: "table", content: [] },
      ]),
      (index) => `fresh-${index}`,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe("paragraph");
  });

  it("clamps a level-1 heading to level 2", () => {
    // The page's h1 is the lesson title; a second one breaks the outline a
    // screen reader announces. Clamped rather than dropped, because the author
    // meant a heading and losing it loses a contents entry.
    const blocks = toBlocks(
      doc([
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
      ]),
      () => "id",
    );
    expect(blocks[0]).toMatchObject({ type: "heading", level: 2 });
  });

  it("derives an anchor when the editor supplies none", () => {
    const blocks = toBlocks(
      doc([
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "States of Matter" }],
        },
      ]),
      () => "id",
    );
    expect(blocks[0]).toMatchObject({ anchor: "states-of-matter" });
  });

  it("drops an unknown mark but keeps the text it was on", () => {
    const blocks = toBlocks(
      doc([
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Highlighted",
              marks: [{ type: "highlight" }, { type: "bold" }],
            },
          ],
        },
      ]),
      () => "id",
    );
    expect(blocks[0]).toEqual({
      id: "id",
      type: "paragraph",
      text: [{ text: "Highlighted", marks: ["bold"] }],
    });
  });

  it("omits marks entirely rather than writing an empty array", () => {
    // `marks: []` and no marks mean the same thing. If the bridge wrote one
    // and the schema the other, every round-trip test would be a false alarm.
    const blocks = toBlocks(
      doc([{ type: "paragraph", content: [{ type: "text", text: "Plain" }] }]),
      () => "id",
    );
    expect(blocks[0]).toEqual({
      id: "id",
      type: "paragraph",
      text: [{ text: "Plain" }],
    });
  });

  it("keeps a link's href", () => {
    const blocks = toBlocks(
      doc([
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "docs",
              marks: [{ type: "link", attrs: { href: "https://a.example" } }],
            },
          ],
        },
      ]),
      () => "id",
    );
    expect(blocks[0]).toMatchObject({
      text: [{ text: "docs", href: "https://a.example" }],
    });
  });
});

describe("fromBlocks", () => {
  it("carries the block id as a node attribute", () => {
    // Without it every save re-keys every block and orphans its translation.
    const doc = fromBlocks([{ id: "keep-me", type: "divider" }]);
    expect(doc.content[0]!.attrs?.blockId).toBe("keep-me");
  });

  it("produces a document shaped like ProseMirror's", () => {
    const doc = fromBlocks(EVERY_BLOCK);
    expect(doc.type).toBe("doc");
    expect(doc.content).toHaveLength(EVERY_BLOCK.length);
    expect(doc.content.every((node) => typeof node.type === "string")).toBe(
      true,
    );
  });
});
