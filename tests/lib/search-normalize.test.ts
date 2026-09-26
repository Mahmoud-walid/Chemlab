import { describe, expect, it } from "vitest";

import { foldText, tokenize } from "@/lib/search/normalize";

/**
 * Every case here is a query a reader can type against copy that is already in
 * `messages/ar.json` or in the seeded catalogue, and every one of them returned
 * nothing before this module existed. A search box that misses is not a
 * degraded search box — it is a reader concluding the lesson is not there.
 */

describe("Arabic folding", () => {
  it("ignores harakat, which nobody types and the copy is full of", () => {
    // `مقرَّر` — the lessons page eyebrow, written with a shadda and a fatha.
    expect(foldText("مُقَرَّر")).toBe(foldText("مقرر"));
    expect(foldText("مُنَظَّمَة")).toBe(foldText("منظمه"));
  });

  it("folds the alef spellings onto one letter", () => {
    const plain = foldText("احمد");
    for (const variant of ["أحمد", "إحمد", "آحمد", "ٱحمد"]) {
      expect(foldText(variant), variant).toBe(plain);
    }
  });

  it("folds taa marbuta onto haa — the commonest Arabic typo there is", () => {
    // `الذرة` and `الذره` are the same word to every reader and two different
    // strings to `includes()`.
    expect(foldText("الذرة")).toBe(foldText("الذره"));
  });

  it("folds alef maksura onto yaa", () => {
    expect(foldText("على")).toBe(foldText("علي"));
  });

  it("drops the tatweel, which is a stretch and not a letter", () => {
    expect(foldText("كيمـــياء")).toBe(
      foldText("\u0643\u064A\u0645\u064A\u0627\u0621"),
    );
  });

  it("folds hamza on waw and on yaa onto their base letters", () => {
    expect(foldText("مؤلف")).toBe(foldText("مولف"));
    expect(foldText("مسئول")).toBe(foldText("مسيول"));
  });

  it("folds Arabic-Indic digits onto ASCII", () => {
    // The lesson numbering renders in Latin digits on purpose; an Arabic
    // keyboard produces the other set.
    expect(foldText("الدرس ٢")).toBe(foldText("الدرس 2"));
    expect(foldText("۱۰")).toBe("10");
  });

  it("removes the invisible characters that split a word in two", () => {
    // A zero-width space, written as an escape: the point of the test is a
    // character nobody can see, so it must not be one nobody can see in the
    // source either.
    expect(foldText("\u0643\u064A\u0645\u200B\u064A\u0627\u0621")).toBe(
      foldText("\u0643\u064A\u0645\u064A\u0627\u0621"),
    );
  });

  it("unpicks an Arabic presentation-form ligature", () => {
    // Pasted text carries these. U+FEFB is one codepoint drawing two letters,
    // and it must match the two letters themselves.
    expect(foldText("\uFEFBزم")).toBe(foldText("لازم"));
  });
});

describe("Latin folding", () => {
  it("ignores accents", () => {
    expect(foldText("Café")).toBe("cafe");
    expect(foldText("Ångström")).toBe("angstrom");
  });

  it("is case-insensitive", () => {
    expect(foldText("ACIDS")).toBe(foldText("acids"));
  });

  it("does not apply the Turkish dotless-i rule", () => {
    // `toLowerCase("tr")` would fold `I` to `ı`, and an English catalogue
    // would then stop matching for a Turkish reader. Folding is about the
    // data, not the reader's phone.
    expect(foldText("IONIC")).toBe("ionic");
  });

  it("folds a subscript digit, which is how chemistry writes a formula", () => {
    // NFKD, not NFD — the whole reason for that choice.
    expect(foldText("H₂O")).toBe("h2o");
  });
});

describe("tokenize", () => {
  it("splits on punctuation rather than through a word", () => {
    expect(tokenize("Acid-base reactions")).toEqual([
      "acid",
      "base",
      "reactions",
    ]);
    expect(tokenize("sodium (Na)")).toEqual(["sodium", "na"]);
  });

  it("keeps a formula together as one token", () => {
    expect(tokenize("H₂O")).toEqual(["h2o"]);
  });

  it("returns nothing for a query that is only punctuation", () => {
    // The honest answer. One empty token would match every item instead.
    expect(tokenize("   ")).toEqual([]);
    expect(tokenize("-- ... ,")).toEqual([]);
    expect(tokenize("")).toEqual([]);
  });

  it("drops Arabic punctuation too", () => {
    expect(tokenize("الذرّة، والجزيء؟")).toEqual(["الذره", "والجزي"]);
  });
});
