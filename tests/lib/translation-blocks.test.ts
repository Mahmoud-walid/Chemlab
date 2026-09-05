import { describe, expect, it } from "vitest";

import {
  applyTranslations,
  translatableFields,
  translatedCount,
  valuesFromBlocks,
} from "@/lib/translations/blocks";
import type { LessonBlock } from "@/lib/lessons/blocks";

/**
 * Translating a body.
 *
 * The claim under test is structural: a translation is the SAME document with
 * the words replaced. Everything here exists to prove there is no path by
 * which it can become a different one.
 */

const body: LessonBlock[] = [
  { id: "h1", type: "heading", level: 2, text: "Acids", anchor: "acids" },
  {
    id: "p1",
    type: "paragraph",
    text: [
      { text: "An acid is a " },
      { text: "proton donor", marks: ["bold"] },
      { text: ", see ", href: undefined },
      { text: "the definition", href: "https://example.test/acid" },
    ],
  },
  {
    id: "img1",
    type: "image",
    url: "https://res.cloudinary.com/demo/a.png",
    alt: "A titration",
    caption: "Titrating an acid",
  },
  {
    id: "img2",
    type: "image",
    url: "https://res.cloudinary.com/demo/b.png",
    // Deliberately decorative.
    alt: "",
  },
  {
    id: "l1",
    type: "list",
    ordered: false,
    items: [[{ text: "Strong" }], [{ text: "Weak" }]],
  },
  { id: "c1", type: "code", language: "text", code: "HCl" },
  { id: "e1", type: "equation", latex: "HCl -> H+ + Cl-" },
  { id: "d1", type: "divider" },
];

describe("translatableFields", () => {
  it("asks for prose and nothing else", () => {
    const keys = translatableFields(body).map((field) => field.key);

    expect(keys).toEqual([
      "h1:text",
      "p1:text.0",
      "p1:text.1",
      "p1:text.2",
      "p1:text.3",
      "img1:alt",
      "img1:caption",
      "img2:alt",
      "l1:items.0.0",
      "l1:items.1.0",
    ]);
  });

  it("never asks for the heading's anchor", () => {
    // The anchor is the fragment a shared link carries. Translating it would
    // break every link into the section from the other language.
    expect(translatableFields(body).some((f) => f.key === "h1:anchor")).toBe(
      false,
    );
  });

  it("leaves code, equations and dividers alone", () => {
    const ids = new Set(translatableFields(body).map((f) => f.blockId));
    expect(ids.has("c1")).toBe(false);
    expect(ids.has("e1")).toBe(false);
    expect(ids.has("d1")).toBe(false);
  });

  it("marks alt and caption optional, and the prose required", () => {
    const byKey = new Map(translatableFields(body).map((f) => [f.key, f]));
    expect(byKey.get("img2:alt")?.optional).toBe(true);
    expect(byKey.get("img1:caption")?.optional).toBe(true);
    expect(byKey.get("p1:text.0")?.optional).toBe(false);
  });

  it("splits inline text per span, so marks and links survive", () => {
    const fields = translatableFields(body).filter((f) => f.blockId === "p1");
    // Four spans, four fields. Flattening to one string and rebuilding as one
    // unmarked span would drop the bold and the link silently.
    expect(fields.map((f) => f.source)).toEqual([
      "An acid is a ",
      "proton donor",
      ", see ",
      "the definition",
    ]);
  });
});

describe("applyTranslations", () => {
  const values = {
    "h1:text": "الأحماض",
    "p1:text.0": "الحمض هو ",
    "p1:text.1": "مانح بروتون",
    "img1:alt": "معايرة",
    "l1:items.0.0": "قوي",
  };

  const out = applyTranslations(body, values);

  it("keeps every id, type and order", () => {
    expect(out.map((block) => `${block.id}:${block.type}`)).toEqual(
      body.map((block) => `${block.id}:${block.type}`),
    );
  });

  it("keeps the marks and href of each span", () => {
    const paragraph = out.find((block) => block.id === "p1");
    expect(paragraph).toMatchObject({
      type: "paragraph",
      text: [
        { text: "الحمض هو " },
        { text: "مانح بروتون", marks: ["bold"] },
        // Untranslated spans keep the source words rather than emptying: a
        // half-written draft should still be a readable document, and
        // `status` is what keeps drafts away from readers.
        { text: ", see " },
        { text: "the definition", href: "https://example.test/acid" },
      ],
    });
  });

  it("keeps the anchor, level, url and dimensions from the source", () => {
    expect(out.find((b) => b.id === "h1")).toMatchObject({
      level: 2,
      anchor: "acids",
      text: "الأحماض",
    });
    expect(out.find((b) => b.id === "img1")).toMatchObject({
      url: "https://res.cloudinary.com/demo/a.png",
      alt: "معايرة",
      // Not translated in `values`, so the source caption stands.
      caption: "Titrating an acid",
    });
  });

  it("leaves a decorative alt empty rather than inventing one", () => {
    expect(out.find((b) => b.id === "img2")).toMatchObject({ alt: "" });
  });

  it("returns code, equations and dividers untouched", () => {
    for (const id of ["c1", "e1", "d1"]) {
      expect(out.find((b) => b.id === id)).toEqual(
        body.find((b) => b.id === id),
      );
    }
  });

  it("ignores a value whose block is gone from the source", () => {
    // The source is the shape. A leftover key from a deleted block cannot
    // resurrect it.
    const result = applyTranslations(body, { "ghost:text.0": "لا شيء" });
    expect(result).toHaveLength(body.length);
    expect(result.some((b) => b.id === "ghost")).toBe(false);
  });

  it("treats whitespace as untranslated", () => {
    const result = applyTranslations(body, { "h1:text": "   " });
    expect(result.find((b) => b.id === "h1")).toMatchObject({ text: "Acids" });
  });
});

describe("valuesFromBlocks", () => {
  it("round-trips what a translator wrote", () => {
    const values = { "h1:text": "الأحماض", "l1:items.1.0": "ضعيف" };
    expect(valuesFromBlocks(body, applyTranslations(body, values))).toEqual(
      values,
    );
  });

  it("returns nothing for a body nobody has translated", () => {
    expect(valuesFromBlocks(body, null)).toEqual({});
    // A stored translation identical to the source is not a translation.
    expect(valuesFromBlocks(body, body)).toEqual({});
  });

  it("shows an empty box for a paragraph the source has since gained", () => {
    const grown: LessonBlock[] = [
      ...body,
      { id: "p2", type: "paragraph", text: [{ text: "And bases." }] },
    ];
    const stored = applyTranslations(body, { "h1:text": "الأحماض" });

    const values = valuesFromBlocks(grown, stored);
    expect(values["h1:text"]).toBe("الأحماض");
    // Present in the field list, absent from the values: an empty box, not a
    // silently dropped paragraph.
    expect(values["p2:text.0"]).toBeUndefined();
    expect(translatableFields(grown).some((f) => f.key === "p2:text.0")).toBe(
      true,
    );
  });

  it("ignores a block whose type changed under the same id", () => {
    const swapped: LessonBlock[] = [
      { id: "h1", type: "paragraph", text: [{ text: "Acids" }] },
    ];
    expect(valuesFromBlocks(body, swapped)).toEqual({});
  });
});

describe("translatedCount", () => {
  it("counts only the required fields", () => {
    // Eight required (heading, four spans, two list items, and one alt that
    // is not optional) — the optional alt and caption are not work owed.
    const { total } = translatedCount(body, {});
    expect(total).toBe(
      translatableFields(body).filter((f) => !f.optional).length,
    );
    expect(translatedCount(body, {}).done).toBe(0);
  });

  it("does not count whitespace as done", () => {
    expect(translatedCount(body, { "h1:text": "  " }).done).toBe(0);
    expect(translatedCount(body, { "h1:text": "الأحماض" }).done).toBe(1);
  });
});
