import { describe, expect, it } from "vitest";

import {
  lessonEditSchema,
  publishBlockers,
  slugify,
  type PublishCandidate,
} from "@/lib/admin/lesson-schema";

/** A complete, valid form payload; each test changes only what it is about. */
function form(overrides: Record<string, unknown> = {}) {
  return {
    slug: "acids-and-bases",
    title: "Acids and bases",
    description: "What makes something acidic.",
    difficulty: "easy",
    category: "Fundamentals",
    coverImageUrl: "",
    references: "",
    tags: "",
    position: "10",
    ...overrides,
  };
}

describe("the lesson slug", () => {
  it.each(["acids-and-bases", "ph", "unit-1", "a", "redox-electrochemistry"])(
    "accepts %s",
    (slug) => {
      expect(lessonEditSchema.parse(form({ slug })).slug).toBe(slug);
    },
  );

  it.each([
    ["Acids And Bases", "capitals would 404 against the lowercase route"],
    ["acids and bases", "a space is not a URL segment"],
    ["-acids", "a leading hyphen reads as an empty first word"],
    ["acids-", "a trailing hyphen reads as an empty last word"],
    ["acids--bases", "a double hyphen is a typo, not a separator"],
    ["", "a lesson with no slug has no URL"],
    ["acids/bases", "a slash would invent a route segment"],
  ])("rejects %j because %s", (slug) => {
    expect(lessonEditSchema.safeParse(form({ slug })).success).toBe(false);
  });

  it("refuses the slug the create route has already claimed", () => {
    // /admin/lessons/new is the create screen; a lesson slugged "new" would be
    // the one lesson its own editor could never open.
    const result = lessonEditSchema.safeParse(form({ slug: "new" }));
    expect(result.success).toBe(false);
  });

  it("trims surrounding whitespace rather than rejecting it", () => {
    expect(lessonEditSchema.parse(form({ slug: "  ph-scale  " })).slug).toBe(
      "ph-scale",
    );
  });
});

describe("slugify", () => {
  it.each([
    ["Acids and Bases", "acids-and-bases"],
    ["The pH scale!", "the-ph-scale"],
    ["  Redox  ", "redox"],
    ["Réactions", "reactions"],
    ["Unit 1 — Basics", "unit-1-basics"],
    ["...", ""],
  ])("suggests %j as %j", (title, expected) => {
    expect(slugify(title)).toBe(expected);
  });

  it("never suggests a slug the schema would then reject", () => {
    for (const title of ["Acids & Bases", "  Trailing  ", "Réactions 2"]) {
      const suggestion = slugify(title);
      expect(
        lessonEditSchema.safeParse(form({ slug: suggestion })).success,
      ).toBe(true);
    }
  });
});

describe("references and tags", () => {
  it("keeps reference order and duplicates", () => {
    // A citation list is the author's sequence, and two entries that look
    // alike may differ by page number.
    const parsed = lessonEditSchema.parse(
      form({ references: "Zumdahl p. 12\nAtkins\nZumdahl p. 12" }),
    );
    expect(parsed.references).toEqual([
      "Zumdahl p. 12",
      "Atkins",
      "Zumdahl p. 12",
    ]);
  });

  it("drops blank reference lines rather than storing empty strings", () => {
    const parsed = lessonEditSchema.parse(
      form({ references: "One\n\n  \nTwo\n" }),
    );
    expect(parsed.references).toEqual(["One", "Two"]);
  });

  it("de-duplicates tags case-insensitively, keeping the first spelling", () => {
    const parsed = lessonEditSchema.parse(
      form({ tags: "Acids, bases, ACIDS" }),
    );
    expect(parsed.tags).toEqual(["Acids", "bases"]);
  });

  it("treats an empty tag field as no tags, not one blank tag", () => {
    expect(lessonEditSchema.parse(form({ tags: "  " })).tags).toEqual([]);
  });
});

describe("the cover image URL", () => {
  it("stores an empty field as null rather than an empty string", () => {
    expect(
      lessonEditSchema.parse(form({ coverImageUrl: "" })).coverImageUrl,
    ).toBe(null);
  });

  it("accepts an https URL", () => {
    const url = "https://example.com/cover.png";
    expect(
      lessonEditSchema.parse(form({ coverImageUrl: url })).coverImageUrl,
    ).toBe(url);
  });

  it.each(["javascript:alert(1)", "data:text/html,<script>", "not a url"])(
    "rejects %j",
    (coverImageUrl) => {
      // These parse as URLs and would go straight into an <img src>.
      expect(lessonEditSchema.safeParse(form({ coverImageUrl })).success).toBe(
        false,
      );
    },
  );
});

describe("position", () => {
  it("parses a numeric string", () => {
    expect(lessonEditSchema.parse(form({ position: "40" })).position).toBe(40);
  });

  it("treats an empty field as the front of the list", () => {
    expect(lessonEditSchema.parse(form({ position: "" })).position).toBe(0);
  });

  it.each(["-1", "1.5", "abc", "999999"])("rejects %j", (position) => {
    expect(lessonEditSchema.safeParse(form({ position })).success).toBe(false);
  });
});

describe("publishBlockers", () => {
  const publishable: PublishCandidate = {
    title: "Acids and bases",
    description: "What makes something acidic.",
    category: "Fundamentals",
    sectionCount: 3,
    deletedAt: null,
  };

  it("allows a complete lesson", () => {
    expect(publishBlockers(publishable)).toEqual([]);
  });

  it("refuses a lesson with no sections, naming the reason", () => {
    // The criterion from #16: an empty body is not publishable. Twelve of the
    // thirteen seeded lessons are in exactly this state.
    expect(publishBlockers({ ...publishable, sectionCount: 0 })).toEqual([
      "missingBody",
    ]);
  });

  it("refuses a withdrawn lesson", () => {
    expect(
      publishBlockers({ ...publishable, deletedAt: new Date() }),
    ).toContain("deleted");
  });

  it("reports every reason at once, not the first one", () => {
    // One refusal at a time turns fixing a lesson into a guessing game.
    expect(
      publishBlockers({
        title: "  ",
        description: "",
        category: "",
        sectionCount: 0,
        deletedAt: null,
      }),
    ).toEqual([
      "missingTitle",
      "missingDescription",
      "missingCategory",
      "missingBody",
    ]);
  });

  it("treats whitespace-only text as missing", () => {
    expect(publishBlockers({ ...publishable, title: "   " })).toEqual([
      "missingTitle",
    ]);
  });
});
