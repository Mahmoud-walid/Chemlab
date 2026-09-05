import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import {
  claimTranslator,
  getLessonTranslation,
  saveLessonTranslation,
  setLessonTranslationStatus,
} from "@/db/queries/admin/translations";
import { getLessonBySlug } from "@/db/queries/lessons";
import { applyTranslations } from "@/lib/translations/blocks";
import type { LessonBlock } from "@/lib/lessons/blocks";

/**
 * Writing a translation, against real Postgres.
 *
 * The claims worth proving here are the ones the pure tests cannot: that the
 * hash is read back from the generated column rather than recomputed, that a
 * save and its sections land in one transaction, and that a status change
 * moves the sections with the lesson — the case where a reader would
 * otherwise get an Arabic summary over an English body.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

const TRANSLATOR = `te-writer-${uuidv7()}`;
const REVIEWER = `te-reviewer-${uuidv7()}`;

let lessonId: string;
let slug: string;
let sectionId: string;

const BODY: LessonBlock[] = [
  { id: "h1", type: "heading", level: 2, text: "Acids", anchor: "acids" },
  { id: "p1", type: "paragraph", text: [{ text: "A proton donor." }] },
];

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  for (const [id, name] of [
    [TRANSLATOR, "Writer"],
    [REVIEWER, "Reviewer"],
  ]) {
    await db
      .insert(schema.users)
      .values({ id, name, email: `${id}@example.test` })
      .onConflictDoNothing();
  }
});

afterAll(async () => {
  await db
    .delete(schema.users)
    .where(sql`${schema.users.id} in (${TRANSLATOR}, ${REVIEWER})`);
  await close?.();
});

beforeEach(async () => {
  // A fresh lesson per test: these mutate status and source text, and a
  // shared row would make the order of the file part of what is asserted.
  lessonId = uuidv7();
  slug = `translate-${lessonId}`;
  await db.insert(schema.lessons).values({
    id: lessonId,
    slug,
    title: "Acids and bases",
    description: "A first look.",
    difficulty: "easy",
    category: "Testing",
    status: "published",
  });
  sectionId = uuidv7();
  await db.insert(schema.lessonSections).values({
    id: sectionId,
    lessonId,
    position: 1,
    heading: "What is an acid?",
    body: BODY,
  });
});

afterAll(async () => {
  await db
    .delete(schema.lessons)
    .where(sql`${schema.lessons.slug} like 'translate-%'`);
});

const write = () =>
  saveLessonTranslation(lessonId, "ar", {
    title: "الأحماض والقواعد",
    description: "نظرة أولى.",
    sections: [
      {
        id: sectionId,
        heading: "ما الحمض؟",
        blocks: applyTranslations(BODY, {
          "h1:text": "الأحماض",
          "p1:text.0": "مانح بروتون.",
        }),
      },
    ],
  });

describe("saving a translation", () => {
  it("starts as a draft, so nothing reaches a reader by saving", async () => {
    await write();

    const view = await getLessonTranslation(slug, "ar");
    expect(view?.translation?.status).toBe("draft");
    expect(view?.sections[0]?.state).toBe("draft");

    // And the reader still gets English.
    expect((await getLessonBySlug(slug, "ar"))?.title).toBe("Acids and bases");
  });

  it("takes the source hash from the generated column, not from code", async () => {
    await write();

    const result = await db.execute<{ matches: boolean }>(sql`
      select t.source_hash = l.source_hash as matches
      from lesson_translations t
      join lessons l on l.id = t.lesson_id
      where t.lesson_id = ${lessonId} and t.locale = 'ar'
    `);
    expect(result.rows[0]?.matches).toBe(true);
  });

  it("clears out-of-date, because saving IS re-reading the source", async () => {
    await write();
    await setLessonTranslationStatus(lessonId, "ar", "published", REVIEWER);

    await db
      .update(schema.lessons)
      .set({ description: "A first look, revised." })
      .where(eq(schema.lessons.id, lessonId));
    expect((await getLessonTranslation(slug, "ar"))?.translation?.stale).toBe(
      true,
    );

    await write();
    expect((await getLessonTranslation(slug, "ar"))?.translation?.stale).toBe(
      false,
    );
  });

  it("reads back exactly what was written", async () => {
    await write();
    const view = await getLessonTranslation(slug, "ar");

    expect(view?.translation?.title).toBe("الأحماض والقواعد");
    expect(view?.sections[0]?.translatedHeading).toBe("ما الحمض؟");
    expect(view?.sections[0]?.values).toEqual({
      "h1:text": "الأحماض",
      "p1:text.0": "مانح بروتون.",
    });
  });
});

describe("the byline", () => {
  it("belongs to whoever wrote it first", async () => {
    await write();
    await claimTranslator(lessonId, "ar", TRANSLATOR);
    // A later editor fixing a typo does not take it: a mistranslated
    // definition should lead back to the person who wrote it.
    await claimTranslator(lessonId, "ar", REVIEWER);

    const [row] = await db
      .select({ translatedBy: schema.lessonTranslations.translatedBy })
      .from(schema.lessonTranslations)
      .where(eq(schema.lessonTranslations.lessonId, lessonId));

    expect(row?.translatedBy).toBe(TRANSLATOR);
  });
});

describe("moving through the workflow", () => {
  it("carries the sections with the lesson", async () => {
    await write();
    await setLessonTranslationStatus(lessonId, "ar", "published", REVIEWER);

    const view = await getLessonTranslation(slug, "ar");
    expect(view?.translation?.status).toBe("published");
    // The case this exists for: a published summary over draft sections would
    // serve an Arabic heading and an English body, and the admin column would
    // report "draft" over a lesson somebody had already published.
    expect(view?.sections[0]?.state).toBe("published");

    const lesson = await getLessonBySlug(slug, "ar");
    expect(lesson?.title).toBe("الأحماض والقواعد");
    expect(lesson?.sections[0]?.heading).toBe("ما الحمض؟");
  });

  it("records who signed it off", async () => {
    await write();
    await setLessonTranslationStatus(lessonId, "ar", "published", REVIEWER);

    const [row] = await db
      .select({
        reviewedBy: schema.lessonTranslations.reviewedBy,
        reviewedAt: schema.lessonTranslations.reviewedAt,
      })
      .from(schema.lessonTranslations)
      .where(eq(schema.lessonTranslations.lessonId, lessonId));

    expect(row?.reviewedBy).toBe(REVIEWER);
    expect(row?.reviewedAt).toBeInstanceOf(Date);
  });

  it("clears the sign-off when it goes back to draft", async () => {
    await write();
    await setLessonTranslationStatus(lessonId, "ar", "published", REVIEWER);
    await setLessonTranslationStatus(lessonId, "ar", "draft", null);

    const [row] = await db
      .select({
        status: schema.lessonTranslations.status,
        reviewedBy: schema.lessonTranslations.reviewedBy,
      })
      .from(schema.lessonTranslations)
      .where(eq(schema.lessonTranslations.lessonId, lessonId));

    // A row saying "reviewed by" while sitting in draft is a claim nobody
    // made.
    expect(row?.status).toBe("draft");
    expect(row?.reviewedBy).toBeNull();

    // And the reader is back to English immediately.
    expect((await getLessonBySlug(slug, "ar"))?.title).toBe("Acids and bases");
  });

  it("does not touch another lesson's translations", async () => {
    await write();

    const otherId = uuidv7();
    const otherSlug = `translate-other-${otherId}`;
    await db.insert(schema.lessons).values({
      id: otherId,
      slug: otherSlug,
      title: "Bases",
      description: "Later.",
      difficulty: "easy",
      category: "Testing",
      status: "published",
    });
    const otherSection = uuidv7();
    await db.insert(schema.lessonSections).values({
      id: otherSection,
      lessonId: otherId,
      position: 1,
      heading: "What is a base?",
      body: BODY,
    });
    await saveLessonTranslation(otherId, "ar", {
      title: "القواعد",
      description: "لاحقًا.",
      sections: [{ id: otherSection, heading: "ما القاعدة؟", blocks: BODY }],
    });

    await setLessonTranslationStatus(lessonId, "ar", "published", REVIEWER);

    // The section update is scoped by a subquery over lesson_sections. A
    // missing scope there would publish every draft section in the database.
    const other = await getLessonTranslation(otherSlug, "ar");
    expect(other?.sections[0]?.state).toBe("draft");
  });
});
