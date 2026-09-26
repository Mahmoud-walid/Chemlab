import { describe, expect, it } from "vitest";

import { searchCatalogue, type SearchField } from "@/lib/search/catalogue";

interface Row {
  slug: string;
  title: string;
  category: string;
  description: string;
}

const FIELDS: SearchField<Row>[] = [
  { read: (row) => row.title, weight: 3 },
  { read: (row) => row.category, weight: 2 },
  { read: (row) => row.description, weight: 1 },
];

const CATALOGUE: Row[] = [
  {
    slug: "atomic-structure",
    title: "Atomic Structure",
    category: "Foundations",
    description: "Protons, neutrons and electrons, and how an atom holds them.",
  },
  {
    slug: "the-periodic-table",
    title: "The Periodic Table",
    category: "Foundations",
    description: "Why the elements line up the way they do.",
  },
  {
    slug: "acids-and-bases",
    title: "Acids and Bases",
    category: "Reactions",
    description: "pH, neutralisation and what makes an acid an acid.",
  },
  {
    slug: "organic-chemistry",
    title: "Organic Chemistry",
    category: "Organic",
    description: "Carbon chains, alkanes and the molecules of life.",
  },
];

const slugs = (rows: readonly Row[]) => rows.map((row) => row.slug);

function search(query: string) {
  return slugs(searchCatalogue({ items: CATALOGUE, query, fields: FIELDS }));
}

describe("an empty query", () => {
  it("returns the catalogue unchanged, by identity", () => {
    // Identity, not equality, and two things ride on it: the lessons page
    // keeps curriculum order when nobody is searching, and the infinite-scroll
    // reveal can tell "the list changed" from "the component re-rendered".
    const result = searchCatalogue({
      items: CATALOGUE,
      query: "",
      fields: FIELDS,
    });
    expect(result).toBe(CATALOGUE);
  });

  it("treats a whitespace-or-punctuation query as empty", () => {
    expect(
      searchCatalogue({ items: CATALOGUE, query: "  ,- ", fields: FIELDS }),
    ).toBe(CATALOGUE);
  });
});

describe("matching", () => {
  it("finds a whole word", () => {
    expect(search("acids")).toEqual(["acids-and-bases"]);
  });

  it("finds a prefix, so results appear while the reader is still typing", () => {
    expect(search("perio")).toEqual(["the-periodic-table"]);
  });

  it("finds the inside of a word", () => {
    // The Arabic requirement in Latin clothing: `الكيمياء` is one token and a
    // reader searching `كيمياء` is searching its middle, so prefix-only
    // matching would return nothing for the most natural query there is.
    expect(search("lkane")).toEqual(["organic-chemistry"]);
  });

  it("is case- and accent-insensitive", () => {
    expect(search("ORGANIC")).toEqual(["organic-chemistry"]);
    expect(search("neutralisatión")).toEqual(["acids-and-bases"]);
  });

  it("searches the category, not only the title", () => {
    expect(search("foundations").sort()).toEqual([
      "atomic-structure",
      "the-periodic-table",
    ]);
  });

  it("searches the description", () => {
    expect(search("protons")).toEqual(["atomic-structure"]);
  });

  it("returns nothing rather than everything for a query that matches nothing", () => {
    expect(search("thermodynamics")).toEqual([]);
  });
});

describe("multiple words", () => {
  it("requires every word — AND, not OR", () => {
    // OR would make a longer query return MORE results, which is the opposite
    // of what typing another word is for.
    expect(search("organic carbon")).toEqual(["organic-chemistry"]);
    expect(search("organic protons")).toEqual([]);
  });

  it("matches words across different fields of the same item", () => {
    // "acids" is the title, "reactions" the category.
    expect(search("acids reactions")).toEqual(["acids-and-bases"]);
  });

  it("does not care about word order", () => {
    expect(search("bases acids")).toEqual(search("acids bases"));
  });
});

describe("ranking", () => {
  it("puts a title hit above a description hit", () => {
    const items: Row[] = [
      {
        slug: "mentions",
        title: "Reaction Rates",
        category: "Kinetics",
        description: "Depends on the concentration of each acid involved.",
      },
      {
        slug: "named",
        title: "Acid Strength",
        category: "Kinetics",
        description: "Strong and weak, and what the difference costs you.",
      },
    ];
    const result = searchCatalogue({ items, query: "acid", fields: FIELDS });
    // Without the field weights the longest description wins every query — it
    // simply contains more words.
    expect(slugs(result)).toEqual(["named", "mentions"]);
  });

  it("puts a whole-word hit above the inside of a longer word", () => {
    const items: Row[] = [
      { slug: "inside", title: "Metalloids", category: "x", description: "y" },
      { slug: "whole", title: "Metal", category: "x", description: "y" },
    ];
    const result = searchCatalogue({ items, query: "metal", fields: FIELDS });
    expect(slugs(result)).toEqual(["whole", "inside"]);
  });

  it("keeps catalogue order between items that score the same", () => {
    // Both match "foundations" in the category and nowhere else, so neither is
    // more relevant and the curriculum decides.
    expect(search("foundations")).toEqual([
      "atomic-structure",
      "the-periodic-table",
    ]);
  });

  it("does not reorder or drop anything for an empty query", () => {
    expect(search("")).toEqual(slugs(CATALOGUE));
  });
});

describe("Arabic content", () => {
  const arabic: Row[] = [
    {
      slug: "atom",
      title: "بنية الذرَّة",
      category: "الأساسيات",
      description: "البروتونات والنيوترونات والإلكترونات.",
    },
    {
      slug: "table",
      title: "الجدول الدوري",
      category: "الأساسيات",
      description: "لماذا تصطف العناصر على هذا النحو.",
    },
  ];

  const find = (query: string) =>
    slugs(searchCatalogue({ items: arabic, query, fields: FIELDS }));

  it("finds a title written with harakat from a query written without", () => {
    expect(find("الذرة")).toEqual(["atom"]);
  });

  it("finds a word inside the definite article", () => {
    // `الجدول` is one token; `جدول` is its middle. This is the case that makes
    // substring matching a requirement rather than a convenience.
    expect(find("جدول")).toEqual(["table"]);
  });

  it("accepts the taa-marbuta spelling a reader is likelier to type", () => {
    expect(find("الذره")).toEqual(["atom"]);
  });

  it("accepts an alef typed without its hamza", () => {
    expect(find("الاساسيات").sort()).toEqual(["atom", "table"]);
  });
});
