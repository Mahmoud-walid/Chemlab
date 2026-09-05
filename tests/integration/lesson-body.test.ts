import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import {
  getEditableSections,
  saveSections,
} from "@/db/queries/admin/lesson-sections";
import { readingTimeSeconds } from "@/lib/lessons/reading-time";
import type { LessonBlock } from "@/lib/lessons/blocks";

/**
 * Saving a lesson body.
 *
 * Three claims need a real database. The write is a whole-body REPLACE in one
 * transaction, so a removed section actually goes. The reading time and the
 * revision move WITH it — a reading time belonging to a body that was never
 * committed is worse than a stale one. And an invalid block is refused at the
 * column rather than stored and dropped later by the renderer.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

let lessonId: string;
const SLUG = `body-suite-${Date.now()}`;

const paragraph = (id: string, text: string): LessonBlock => ({
  id,
  type: "paragraph",
  text: [{ text }],
});

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  lessonId = uuidv7();
  await db.insert(schema.lessons).values({
    id: lessonId,
    slug: SLUG,
    title: "Body suite lesson",
    description: "Created by tests/integration/lesson-body.test.ts.",
    difficulty: "easy",
    category: "Testing",
    status: "draft",
  });
});

afterEach(async () => {
  await db
    .delete(schema.lessonSections)
    .where(eq(schema.lessonSections.lessonId, lessonId));
});

afterAll(async () => {
  await db.delete(schema.lessons).where(eq(schema.lessons.id, lessonId));
  await close?.();
});

async function lesson() {
  const [row] = await db
    .select({
      revision: schema.lessons.revision,
      readingTimeSeconds: schema.lessons.readingTimeSeconds,
    })
    .from(schema.lessons)
    .where(eq(schema.lessons.id, lessonId));
  return row!;
}

describe("saveSections", () => {
  it("writes sections in the order given", async () => {
    await saveSections(lessonId, [
      { heading: "Second-written", blocks: [paragraph("a", "A.")] },
      { heading: "First-written", blocks: [paragraph("b", "B.")] },
    ]);

    const sections = await getEditableSections(lessonId);
    expect(sections.map((s) => s.heading)).toEqual([
      "Second-written",
      "First-written",
    ]);
    expect(sections.map((s) => s.position)).toEqual([0, 1]);
  });

  it("replaces the whole body, so a removed section is gone", async () => {
    await saveSections(lessonId, [
      { heading: "Keep", blocks: [paragraph("a", "A.")] },
      { heading: "Remove", blocks: [paragraph("b", "B.")] },
    ]);
    await saveSections(lessonId, [
      { heading: "Keep", blocks: [paragraph("a", "A.")] },
    ]);

    const sections = await getEditableSections(lessonId);
    expect(sections.map((s) => s.heading)).toEqual(["Keep"]);
  });

  it("keeps the block ids it was given", async () => {
    // The ids are what a translation is attached to. Re-keying them on save
    // orphans every translation made from the old body.
    await saveSections(lessonId, [
      { heading: "One", blocks: [paragraph("stable-id", "A.")] },
    ]);

    const [section] = await getEditableSections(lessonId);
    expect(section!.blocks[0]!.id).toBe("stable-id");
  });

  it("recomputes the reading time from the saved blocks", async () => {
    const blocks = [
      paragraph("a", Array.from({ length: 440 }, () => "word").join(" ")),
    ];
    const result = await saveSections(lessonId, [{ heading: "Long", blocks }]);

    expect(result.readingTimeSeconds).toBe(readingTimeSeconds(blocks));
    expect((await lesson()).readingTimeSeconds).toBe(result.readingTimeSeconds);
  });

  it("bumps the revision on every save", async () => {
    const before = (await lesson()).revision;
    await saveSections(lessonId, [
      { heading: "One", blocks: [paragraph("a", "A.")] },
    ]);
    const after = (await lesson()).revision;

    // Translation staleness depends on this: a revision that did not move
    // leaves every translation looking current against a body that changed.
    expect(after).toBe(before + 1);
  });

  it("refuses a block the schema rejects, and writes nothing", async () => {
    await saveSections(lessonId, [
      { heading: "Good", blocks: [paragraph("a", "A.")] },
    ]);

    await expect(
      saveSections(lessonId, [
        // A heading level the document outline cannot carry.
        {
          heading: "Bad",
          blocks: [
            { id: "x", type: "heading", level: 1, text: "No", anchor: "no" },
          ] as unknown as LessonBlock[],
        },
      ]),
    ).rejects.toThrow();

    // The refusal happens before the transaction opens, so the previous body
    // is still there — a rejected save must not empty the lesson.
    const sections = await getEditableSections(lessonId);
    expect(sections.map((s) => s.heading)).toEqual(["Good"]);
  });

  it("accepts an empty body", async () => {
    await saveSections(lessonId, [
      { heading: "One", blocks: [paragraph("a", "A.")] },
    ]);
    const result = await saveSections(lessonId, []);

    expect(result.sections).toBe(0);
    expect(await getEditableSections(lessonId)).toEqual([]);
    // No content is no reading time. Reporting the old one would describe a
    // lesson that no longer exists.
    expect((await lesson()).readingTimeSeconds).toBe(0);
  });
});

describe("getEditableSections", () => {
  it("returns an empty body rather than an unrenderable one", async () => {
    // A row predating a schema change must not be loaded into the editor and
    // saved back, which would launder it into the table as though valid.
    await db.insert(schema.lessonSections).values({
      id: uuidv7(),
      lessonId,
      position: 0,
      heading: "Legacy",
      body: [{ id: "x", type: "hologram" }] as unknown as LessonBlock[],
    });

    const [section] = await getEditableSections(lessonId);
    expect(section!.heading).toBe("Legacy");
    expect(section!.blocks).toEqual([]);
  });
});
