import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import { loadSeedSource, type SeedSource } from "@/db/seed/source";
import { verifyContent } from "@/db/seed/verify";
import * as schema from "@/db/schema";
import { asc, eq, isNull, sql } from "drizzle-orm";

/**
 * What `tests/data/*.test.ts` used to assert about the JSON, now asserted
 * about the seeded database — the thing the pages actually read.
 *
 * The JSON-shape tests stay in the unit project as a fast lane guarding the
 * seed INPUT. These guard the seed OUTPUT, which is where a mapping bug, a
 * missing constraint or a dropped column shows up.
 */

let db: SeedDatabase;
let close: () => Promise<void>;
let source: SeedSource;

beforeAll(async () => {
  const url = seedUrl();
  // The setup file has already refused to run without one; this keeps
  // TypeScript honest and fails clearly if that ever changes.
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));
  source = await loadSeedSource();
});

afterAll(async () => {
  await close?.();
});

describe("seeded content", () => {
  it("matches data/ field by field", async () => {
    // The same verifier `pnpm db:verify` runs, so the two can never disagree.
    expect(await verifyContent(db)).toEqual([]);
  });

  it("holds the expected row counts", async () => {
    expect(Number(await db.$count(schema.elements))).toBe(
      source.elements.length,
    );
    expect(Number(await db.$count(schema.lessons))).toBe(source.lessons.length);
    expect(Number(await db.$count(schema.quizzes))).toBe(source.quizzes.length);
    expect(Number(await db.$count(schema.quizQuestions))).toBe(
      source.quizzes.reduce((n, quiz) => n + quiz.questions.length, 0),
    );
  });
});

describe("elements", () => {
  it("covers atomic numbers 1..n with no gaps and no duplicates", async () => {
    const rows = await db
      .select({
        number: schema.elements.number,
        symbol: schema.elements.symbol,
      })
      .from(schema.elements)
      .orderBy(asc(schema.elements.number));

    expect(rows[0]?.symbol).toBe("H");
    rows.forEach((row, index) => expect(row.number).toBe(index + 1));
  });

  it("has unique names and symbols", async () => {
    const rows = await db
      .select({ name: schema.elements.name, symbol: schema.elements.symbol })
      .from(schema.elements);

    expect(new Set(rows.map((r) => r.name)).size).toBe(rows.length);
    expect(new Set(rows.map((r) => r.symbol)).size).toBe(rows.length);
  });

  it("places every element on the 18x10 grid, one element per cell", async () => {
    const rows = await db
      .select({
        xpos: schema.elements.xpos,
        ypos: schema.elements.ypos,
        period: schema.elements.period,
      })
      .from(schema.elements);

    for (const row of rows) {
      expect(row.xpos).toBeGreaterThanOrEqual(1);
      expect(row.xpos).toBeLessThanOrEqual(18);
      expect(row.ypos).toBeGreaterThanOrEqual(1);
      expect(row.ypos).toBeLessThanOrEqual(10);
      expect(row.period).toBeGreaterThanOrEqual(1);
    }
    // The unique index is what actually prevents two elements sharing a cell;
    // this proves it is doing its job on real data.
    expect(new Set(rows.map((r) => `${r.xpos},${r.ypos}`)).size).toBe(
      rows.length,
    );
  });

  it("keeps the shell and ionization vectors as non-empty typed arrays", async () => {
    const rows = await db
      .select({
        symbol: schema.elements.symbol,
        shells: schema.elements.shells,
        ionizationEnergies: schema.elements.ionizationEnergies,
      })
      .from(schema.elements);

    for (const row of rows) {
      expect(row.shells.length, row.symbol).toBeGreaterThan(0);
      expect(
        row.shells.every((shell) => shell > 0),
        row.symbol,
      ).toBe(true);
      // Postgres arrays come back as numbers, not strings — a driver or column
      // type change that broke this would silently break every chart.
      expect(typeof row.shells[0]).toBe("number");
      for (const energy of row.ionizationEnergies) {
        expect(typeof energy).toBe("number");
      }
    }
  });

  it("rejects a duplicate atomic number", async () => {
    const [existing] = await db
      .select()
      .from(schema.elements)
      .where(eq(schema.elements.number, 1));

    await expect(
      db
        .insert(schema.elements)
        .values({ ...existing!, id: undefined, symbol: "Xx" }),
    ).rejects.toThrow();
  });
});

describe("lessons", () => {
  it("has unique, well-formed slugs and renderable fields", async () => {
    const rows = await db.select().from(schema.lessons);

    expect(new Set(rows.map((r) => r.slug)).size).toBe(rows.length);
    for (const row of rows) {
      expect(row.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(row.title.trim()).not.toBe("");
      expect(row.description.trim()).not.toBe("");
      expect(["easy", "medium", "hard"]).toContain(row.difficulty);
      expect(row.category.trim()).not.toBe("");
    }
  });

  it("publishes every seeded lesson and soft-deletes none", async () => {
    // A lesson that is not published is invisible to the site, which is the
    // same symptom as a lesson that failed to seed. Both halves are checked:
    // `status` is what the public queries filter on, `published_at` records
    // when it went live, and one without the other is a row whose two answers
    // to "is this live" disagree.
    const [counts] = await db
      .select({
        unpublished: sql<number>`count(*) filter (where ${schema.lessons.status} <> 'published')::int`,
        undated: sql<number>`count(*) filter (where ${schema.lessons.publishedAt} is null)::int`,
        deleted: sql<number>`count(*) filter (where ${schema.lessons.deletedAt} is not null)::int`,
      })
      .from(schema.lessons);
    expect(counts).toEqual({ unpublished: 0, undated: 0, deleted: 0 });
  });

  it("stores sections in order as rich-text documents", async () => {
    const [lesson] = await db
      .select()
      .from(schema.lessons)
      .where(eq(schema.lessons.slug, "introduction-basics"));

    const sections = await db
      .select()
      .from(schema.lessonSections)
      .where(eq(schema.lessonSections.lessonId, lesson!.id))
      .orderBy(asc(schema.lessonSections.position));

    expect(sections.length).toBeGreaterThan(0);
    sections.forEach((section, index) => {
      expect(section.position).toBe(index);
      expect(Array.isArray(section.body)).toBe(true);
      expect(section.body.length).toBeGreaterThan(0);
      expect(section.body[0]!.type).toBe("paragraph");
    });
  });

  it("cascades section deletion from its lesson", async () => {
    // Proven rather than assumed: `onDelete: "cascade"` is easy to write in the
    // schema and easy to lose in a hand-edited migration.
    const [lesson] = await db
      .insert(schema.lessons)
      .values({
        slug: `cascade-probe-${Date.now()}`,
        title: "Cascade probe",
        description: "Temporary row used by the integration suite.",
        difficulty: "easy",
        category: "Testing",
      })
      .returning({ id: schema.lessons.id });

    await db.insert(schema.lessonSections).values({
      lessonId: lesson!.id,
      position: 0,
      heading: "Probe",
      body: [],
    });

    await db.delete(schema.lessons).where(eq(schema.lessons.id, lesson!.id));

    const orphans = await db
      .select()
      .from(schema.lessonSections)
      .where(eq(schema.lessonSections.lessonId, lesson!.id));
    expect(orphans).toEqual([]);
  });
});

describe("quizzes", () => {
  it("has unique slugs and unique question text within each quiz", async () => {
    const quizzes = await db.select().from(schema.quizzes);
    expect(new Set(quizzes.map((q) => q.slug)).size).toBe(quizzes.length);

    for (const quiz of quizzes) {
      const questions = await db
        .select({ prompt: schema.quizQuestions.prompt })
        .from(schema.quizQuestions)
        .where(eq(schema.quizQuestions.quizId, quiz.id));

      expect(
        new Set(questions.map((q) => q.prompt)).size,
        `duplicate question in ${quiz.slug}`,
      ).toBe(questions.length);
    }
  });

  it("gives every question at least two distinct options", async () => {
    const rows = await db
      .select({
        questionId: schema.quizOptions.questionId,
        label: schema.quizOptions.label,
      })
      .from(schema.quizOptions);

    const byQuestion = new Map<string, string[]>();
    for (const row of rows) {
      byQuestion.set(row.questionId, [
        ...(byQuestion.get(row.questionId) ?? []),
        row.label,
      ]);
    }

    expect(byQuestion.size).toBeGreaterThan(0);
    for (const [questionId, labels] of byQuestion) {
      expect(labels.length, questionId).toBeGreaterThanOrEqual(2);
      expect(new Set(labels).size, questionId).toBe(labels.length);
    }
  });

  it("resolves every answer through the foreign key, not a duplicated string", async () => {
    // This is the whole point of the migration: the answer is a reference, so
    // there is no way for it to name an option that does not exist.
    const [{ count: unresolved }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.quizQuestions)
      .where(isNull(schema.quizQuestions.correctOptionId));
    expect(unresolved).toBe(0);

    const [{ count: foreign }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.quizQuestions)
      .innerJoin(
        schema.quizOptions,
        eq(schema.quizOptions.id, schema.quizQuestions.correctOptionId),
      )
      .where(
        sql`${schema.quizOptions.questionId} <> ${schema.quizQuestions.id}`,
      );
    // A correct option belonging to a different question would make the quiz
    // unanswerable while every count still looked right.
    expect(foreign).toBe(0);
  });
});
