import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { getLessonBySlug, relatedLessons } from "@/db/queries/lessons";
import { blocksSchema } from "@/lib/lessons/blocks";
import { readingTimeSeconds } from "@/lib/lessons/reading-time";

/**
 * The lesson body, from `data/` to the page.
 *
 * The claim that needs a real database: **the migration to blocks is
 * lossless**. #20's acceptance criterion is that `introduction-basics` keeps
 * every section of `data/lessons/introduction-basics.json`, and the only way
 * to check that is to read the JSON and the rows and compare the prose.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

interface BodyJson {
  slug: string;
  sections: { heading: string; body?: string; blocks?: unknown[] }[];
}

let introduction: BodyJson;

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  introduction = JSON.parse(
    await readFile(
      path.join(process.cwd(), "data", "lessons", "introduction-basics.json"),
      "utf8",
    ),
  ) as BodyJson;
});

afterAll(async () => {
  await close?.();
});

describe("the seeded lesson body", () => {
  it("keeps every section of the JSON, in order", async () => {
    const lesson = await getLessonBySlug("introduction-basics", "en");
    expect(lesson).not.toBeNull();
    expect(lesson!.sections.map((section) => section.heading)).toEqual(
      introduction.sections.map((section) => section.heading),
    );
  });

  it("keeps the prose verbatim", async () => {
    const lesson = await getLessonBySlug("introduction-basics", "en");
    lesson!.sections.forEach((section, index) => {
      const expected = introduction.sections[index]!.body!.trim();
      // Whitespace between paragraphs is normalised by the conversion; the
      // words are not, and those are what a reader loses if this drifts.
      expect(section.text.replaceAll(/\s+/g, " ")).toBe(
        expected.replaceAll(/\s+/g, " "),
      );
    });
  });

  it("stores blocks that still validate against the schema", async () => {
    // The column is jsonb: nothing but this assertion stops a row from
    // holding a shape the renderer will silently drop.
    const rows = await db
      .select({ body: schema.lessonSections.body })
      .from(schema.lessonSections);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(blocksSchema.safeParse(row.body).success).toBe(true);
    }
  });

  it("gives every block a stable id", async () => {
    const lesson = await getLessonBySlug("introduction-basics", "en");
    const ids = lesson!.sections.flatMap((section) =>
      section.body.map((block) => block.id),
    );
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    // The seed derives ids from slug and position — see textToBlocks. A random
    // id here would mean every re-seed orphans every translation.
    expect(ids[0]).toMatch(/^introduction-basics-s1-/);
  });

  it("gives each section an anchor that does not depend on the locale", async () => {
    const english = await getLessonBySlug("introduction-basics", "en");
    const arabic = await getLessonBySlug("introduction-basics", "ar");
    expect(arabic!.sections.map((s) => s.anchor)).toEqual(
      english!.sections.map((s) => s.anchor),
    );
  });

  it("carries the reading time the blocks imply", async () => {
    const lesson = await getLessonBySlug("introduction-basics", "en");
    const recomputed = readingTimeSeconds(
      lesson!.sections.flatMap((section) => section.body),
    );
    expect(lesson!.readingTimeSeconds).toBe(recomputed);
    expect(lesson!.readingTimeSeconds).toBeGreaterThan(0);
  });
});

describe("a body authored as blocks", () => {
  it("keeps the callouts the hand-written route used to render", async () => {
    // `studying-chemistry` was a route file whose callouts lived in JSX.
    const lesson = await getLessonBySlug("studying-chemistry", "en");
    expect(lesson).not.toBeNull();

    const callouts = lesson!.sections
      .flatMap((section) => section.body)
      .filter((block) => block.type === "callout");
    expect(callouts.length).toBeGreaterThan(0);
  });
});

describe("relatedLessons", () => {
  it("never returns the lesson being read", async () => {
    const related = await relatedLessons("introduction-basics", "en");
    expect(related.map((row) => row.slug)).not.toContain("introduction-basics");
  });

  it("prefers the same category", async () => {
    const related = await relatedLessons("introduction-basics", "en");
    expect(related.length).toBeGreaterThan(0);
    expect(related[0]!.category).toBe("Basics");
  });

  it("is capped", async () => {
    expect(
      (await relatedLessons("introduction-basics", "en")).length,
    ).toBeLessThanOrEqual(3);
  });
});

describe("the body column", () => {
  it("refuses a body that is not an array", async () => {
    // A CHECK constraint, not a convention: the shape is an invariant of the
    // table, so a writer storing the old ProseMirror document fails loudly
    // instead of blanking a lesson for every reader.
    const [lesson] = await db
      .select({ id: schema.lessons.id })
      .from(schema.lessons)
      .where(eq(schema.lessons.slug, "introduction-basics"));

    await expect(
      db.execute(sql`
        insert into lesson_sections (lesson_id, position, heading, body)
        values (${lesson!.id}, 999, 'Bad shape', '{"type":"doc"}'::jsonb)
      `),
    ).rejects.toThrow();
  });
});
