import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { isStale } from "@/db/queries/translations";
import { getLessonBySlug, listLessons } from "@/db/queries/lessons";
import { listQuizzes } from "@/db/queries/quizzes";
import {
  createLesson,
  createQuiz,
  createSection,
  createUser,
  paragraphBody,
} from "../factories";
import { allPermissionNames } from "@/db/seed/rbac";

/**
 * The translation workflow, against real Postgres.
 *
 * Every claim here is about the DATABASE. Staleness is a generated column
 * compared against a stored copy of itself, ownership is two foreign keys
 * with `on delete set null`, and the backfill is a migration. A mock would
 * confirm the mock, and the one bug this feature exists to prevent — a stale
 * translation that does not know it is stale — is invisible without Postgres
 * actually recomputing the hash.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

const TRANSLATOR = `t-translator-${uuidv7()}`;
const REVIEWER = `t-reviewer-${uuidv7()}`;

let lessonId: string;
let sectionId: string;

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  await createUser(db, { id: TRANSLATOR, name: "Translator" });
  await createUser(db, { id: REVIEWER, name: "Reviewer" });

  lessonId = uuidv7();
  await db.insert(schema.lessons).values({
    id: lessonId,
    slug: `translations-${lessonId}`,
    title: "Acids and bases",
    description: "A first look.",
    difficulty: "easy",
    category: "Testing",
  });

  sectionId = uuidv7();
  await db.insert(schema.lessonSections).values({
    id: sectionId,
    lessonId,
    position: 1,
    heading: "What is an acid?",
    body: [
      { id: "b1", type: "paragraph", text: [{ text: "A proton donor." }] },
    ],
  });
});

afterAll(async () => {
  await db.delete(schema.lessons).where(eq(schema.lessons.id, lessonId));
  await db
    .delete(schema.users)
    .where(sql`${schema.users.id} in (${TRANSLATOR}, ${REVIEWER})`);
  await close?.();
});

/** The one comparison the whole feature rests on. */
async function lessonIsStale(locale: string): Promise<boolean> {
  const [row] = await db
    .select({
      stale: isStale(
        schema.lessonTranslations.sourceHash,
        schema.lessons.sourceHash,
      ),
    })
    .from(schema.lessonTranslations)
    .innerJoin(
      schema.lessons,
      eq(schema.lessons.id, schema.lessonTranslations.lessonId),
    )
    .where(
      sql`${schema.lessonTranslations.lessonId} = ${lessonId}
          and ${schema.lessonTranslations.locale} = ${locale}`,
    );
  return row?.stale ?? false;
}

/**
 * A published Arabic translation, current against the source as it stands.
 *
 * An upsert rather than an insert: it runs before every staleness test, and
 * the row may already exist from the one before. Resetting `source_hash` here
 * is what makes each test start from "translated and up to date" regardless
 * of what its predecessor did to the source.
 */
async function translateInto(locale: string): Promise<void> {
  const currentHash = sql`(select source_hash from lessons where id = ${lessonId})`;

  await db
    .insert(schema.lessonTranslations)
    .values({
      lessonId,
      locale,
      title: "الأحماض والقواعد",
      description: "نظرة أولى.",
      status: "published",
      translatedBy: TRANSLATOR,
      // Read from the generated column, never recomputed here — the same rule
      // the application writers follow.
      sourceHash: currentHash,
    })
    .onConflictDoUpdate({
      target: [
        schema.lessonTranslations.lessonId,
        schema.lessonTranslations.locale,
      ],
      set: {
        title: "الأحماض والقواعد",
        description: "نظرة أولى.",
        status: "published",
        sourceHash: currentHash,
      },
    });
}

describe("staleness", () => {
  /**
   * Every test here starts from the same place: an Arabic translation made
   * from the source as it stands.
   *
   * It used to be a narrative — one test translated, the next edited the
   * source, the third redid the translation — which reads well and fails the
   * moment the order changes. `--sequence.shuffle` found it.
   */
  beforeEach(async () => {
    await translateInto("ar");
  });

  it("is false for a translation made from the source as it stands", async () => {
    expect(await lessonIsStale("ar")).toBe(false);
  });

  it("becomes true the moment the source is edited, with no marking step", async () => {
    // No call to any "mark stale" function: the source's hash is a generated
    // column, so Postgres recomputes it inside this UPDATE. That is what
    // makes the marking atomic with the save rather than a second write that
    // can be forgotten, fail, or run in a different transaction.
    await db
      .update(schema.lessons)
      .set({ description: "A first look, revised." })
      .where(eq(schema.lessons.id, lessonId));

    expect(await lessonIsStale("ar")).toBe(true);
  });

  it("clears when the translation is redone from the new source", async () => {
    // Make it stale first, rather than inheriting staleness from whichever
    // test happened to run before this one. The new text is unique per run:
    // writing the SAME description a previous test already wrote changes no
    // bytes, so the generated hash is unchanged and nothing goes stale.
    await db
      .update(schema.lessons)
      .set({ description: `A first look, revised ${uuidv7()}.` })
      .where(eq(schema.lessons.id, lessonId));
    expect(await lessonIsStale("ar")).toBe(true);

    await db
      .update(schema.lessonTranslations)
      .set({
        description: "نظرة أولى، منقحة.",
        sourceHash: sql`(select source_hash from lessons where id = ${lessonId})`,
      })
      .where(
        sql`${schema.lessonTranslations.lessonId} = ${lessonId}
            and ${schema.lessonTranslations.locale} = 'ar'`,
      );

    expect(await lessonIsStale("ar")).toBe(false);
  });

  it("ignores a field no translator reads", async () => {
    // `category` is not part of the lesson's translatable copy, so changing
    // it must not send the Arabic version back for rework. A hash over the
    // whole row would fail this, and the cost of failing it is a translator
    // re-reading an article that did not change.
    await db
      .update(schema.lessons)
      .set({ category: "Testing (renamed)" })
      .where(eq(schema.lessons.id, lessonId));

    expect(await lessonIsStale("ar")).toBe(false);
  });

  it("does not fire for a jsonb body that was rewritten to the same value", async () => {
    const [before] = await db
      .select({ hash: schema.lessonSections.sourceHash })
      .from(schema.lessonSections)
      .where(eq(schema.lessonSections.id, sectionId));

    // The same document, keys in a different order. jsonb normalises on
    // input, so an editor whose serialiser reorders keys must not mark every
    // Arabic section stale for a change that is not one.
    await db.execute(sql`
      update lesson_sections
      set body = '[{"text":[{"text":"A proton donor."}],"type":"paragraph","id":"b1"}]'::jsonb
      where id = ${sectionId}
    `);

    const [after] = await db
      .select({ hash: schema.lessonSections.sourceHash })
      .from(schema.lessonSections)
      .where(eq(schema.lessonSections.id, sectionId));

    expect(after?.hash).toBe(before?.hash);
  });

  it("distinguishes fields that were merely rearranged between them", async () => {
    // ("ab", "c") and ("a", "bc") must not hash alike, or moving a word from
    // the title into the description would read as no change at all.
    const result = await db.execute<{ same: boolean }>(sql`
      select md5('ab' || E'\\x1f' || 'c') = md5('a' || E'\\x1f' || 'bc') as same
    `);
    expect(result.rows[0]?.same).toBe(false);
  });
});

describe("the source fingerprint", () => {
  it("cannot be written by hand", async () => {
    // GENERATED ALWAYS, not a default: an application that thinks it knows
    // better is refused rather than silently trusted. This is what stops a
    // second hash implementation appearing and drifting.
    await expect(
      db.execute(sql`
        update lessons set source_hash = 'nonsense' where id = ${lessonId}
      `),
    ).rejects.toThrow();
  });
});

describe("ownership", () => {
  it("survives the translator's account being deleted", async () => {
    // Its own translation, rather than one left behind by the staleness
    // tests. This test deletes an account, so it must own what it deletes.
    await translateInto("ar");
    await db
      .update(schema.lessonTranslations)
      .set({ reviewedBy: REVIEWER, reviewedAt: new Date() })
      .where(
        sql`${schema.lessonTranslations.lessonId} = ${lessonId}
            and ${schema.lessonTranslations.locale} = 'ar'`,
      );

    await db.delete(schema.users).where(eq(schema.users.id, TRANSLATOR));

    const [row] = await db
      .select({
        translatedBy: schema.lessonTranslations.translatedBy,
        reviewedBy: schema.lessonTranslations.reviewedBy,
        title: schema.lessonTranslations.title,
      })
      .from(schema.lessonTranslations)
      .where(
        sql`${schema.lessonTranslations.lessonId} = ${lessonId}
            and ${schema.lessonTranslations.locale} = 'ar'`,
      );

    // The translation stays and keeps working; only the byline is lost. The
    // alternative — cascading the delete — would remove published Arabic
    // content because somebody closed their account.
    expect(row?.translatedBy).toBeNull();
    expect(row?.reviewedBy).toBe(REVIEWER);
    expect(row?.title).toBe("الأحماض والقواعد");
  });
});

describe("the default-locale mirror rows", () => {
  it("are published and never stale against their own source", async () => {
    // Every seeded lesson and quiz carries an `en` row that mirrors the
    // source. If one of those ever read as stale, the staleness filter would
    // be permanently full of rows nobody can act on.
    const result = await db.execute<{ stale: number }>(sql`
      select count(*)::int as stale
      from lesson_translations t
      join lessons l on l.id = t.lesson_id
      where t.locale = 'en'
        and (t.source_hash is distinct from l.source_hash or t.status <> 'published')
    `);
    expect(result.rows[0]?.stale).toBe(0);
  });
});

describe("permissions", () => {
  it("seeds translation:read, :write and :review as real rows", async () => {
    // `requirePermission()` throws on a name that matches no row, so a
    // permission that is checked but never seeded fails closed and loudly —
    // but only when somebody exercises that path. This asserts it up front.
    const wanted = [
      "translation:read",
      "translation:write",
      "translation:review",
    ];
    expect(allPermissionNames()).toEqual(expect.arrayContaining(wanted));

    const rows = await db
      .select({ name: schema.permissions.name })
      .from(schema.permissions)
      .where(
        sql`${schema.permissions.name} in ('translation:read', 'translation:write', 'translation:review')`,
      );

    expect(rows.map((row) => row.name).sort()).toEqual(
      ["translation:read", "translation:review", "translation:write"].sort(),
    );
  });

  it("gives the editor role write but not review", async () => {
    const result = await db.execute<{ name: string }>(sql`
      select p.name
      from roles r
      join role_permissions rp on rp.role_id = r.id
      join permissions p on p.id = rp.permission_id
      where r.key = 'editor' and p.resource = 'translation'
    `);

    expect(result.rows.map((row) => row.name).sort()).toEqual([
      "translation:read",
      "translation:write",
    ]);
  });
});

/**
 * What a reader actually gets — the half of #62 that is a decision about
 * people rather than about data.
 *
 * These go through the real public queries rather than asserting on the
 * columns, because the bug worth catching is a query that selects the
 * staleness comparison and then forgets to act on it. The columns would look
 * perfect.
 */
describe("what the reader is served", () => {
  let readableSlug: string;
  let readableId: string;

  beforeAll(async () => {
    // Published, or the public query will not return it at all and every
    // assertion below would pass for the wrong reason.
    const lesson = await createLesson(db, {
      slug: `reader-${uuidv7()}`,
      title: "Bonding",
      description: "How atoms hold on.",
      status: "published",
    });
    readableId = lesson.id;
    readableSlug = lesson.slug;

    await createSection(db, readableId, {
      heading: "Ionic bonds",
      body: paragraphBody("Give and take."),
    });
  });

  afterAll(async () => {
    await db.delete(schema.lessons).where(eq(schema.lessons.id, readableId));
  });

  async function translate(status: "draft" | "in_review" | "published") {
    await db
      .insert(schema.lessonTranslations)
      .values({
        lessonId: readableId,
        locale: "ar",
        title: "الروابط",
        description: "كيف تتماسك الذرات.",
        status,
        sourceHash: sql`(select source_hash from lessons where id = ${readableId})`,
      })
      .onConflictDoUpdate({
        target: [
          schema.lessonTranslations.lessonId,
          schema.lessonTranslations.locale,
        ],
        set: {
          status,
          sourceHash: sql`(select source_hash from lessons where id = ${readableId})`,
        },
      });
  }

  it("does not serve a draft translation", async () => {
    await translate("draft");
    const lesson = await getLessonBySlug(readableSlug, "ar");

    // The workflow columns are decorative if a reader sees the draft anyway.
    expect(lesson?.title).toBe("Bonding");
    expect(lesson?.isTranslated).toBe(false);
    expect(lesson?.translationOutOfDate).toBe(false);
  });

  it("does not serve one that is still in review", async () => {
    await translate("in_review");
    expect((await getLessonBySlug(readableSlug, "ar"))?.title).toBe("Bonding");
  });

  it("serves a published, current translation with no notice", async () => {
    await translate("published");
    const lesson = await getLessonBySlug(readableSlug, "ar");

    expect(lesson?.title).toBe("الروابط");
    expect(lesson?.isTranslated).toBe(true);
    expect(lesson?.translationOutOfDate).toBe(false);
  });

  it("keeps serving it once the English moves on, and says so", async () => {
    // Published here rather than inherited from the test above: this is the
    // state the assertion is about, so it is this test's to establish.
    await translate("published");

    await db
      .update(schema.lessons)
      .set({ description: `How atoms hold on, revised ${uuidv7()}.` })
      .where(eq(schema.lessons.id, readableId));

    const lesson = await getLessonBySlug(readableSlug, "ar");

    // Still Arabic: yanking a reader back to English mid-article is worse
    // than telling them the translation may be behind.
    expect(lesson?.title).toBe("الروابط");
    expect(lesson?.isTranslated).toBe(true);
    expect(lesson?.translationOutOfDate).toBe(true);
  });

  it("applies the same rule to the catalogue", async () => {
    await translate("published");
    // Unique, for the same reason as above: rewriting the same words is not
    // an edit, and the hash would not move.
    await db
      .update(schema.lessons)
      .set({ description: `How atoms hold on, revised ${uuidv7()}.` })
      .where(eq(schema.lessons.id, readableId));

    const summary = (await listLessons("ar")).find(
      (row) => row.slug === readableSlug,
    );

    expect(summary?.title).toBe("الروابط");
    expect(summary?.translationOutOfDate).toBe(true);
  });

  it("never marks the default locale out of date", async () => {
    // The `en` mirror row moves with the source, so English readers must
    // never see the notice — it would appear on every lesson, forever.
    const lesson = await getLessonBySlug(readableSlug, "en");
    expect(lesson?.translationOutOfDate).toBe(false);
    expect(lesson?.title).toBe("Bonding");
  });
});

/**
 * The other half of the §4 decision, and the reason it is two policies rather
 * than one: the same staleness that earns a lesson a notice takes a quiz back
 * to English.
 */
describe("assessed content is treated differently", () => {
  let quizId: string;
  let quizSlug: string;

  beforeAll(async () => {
    const quiz = await createQuiz(db, {
      slug: `reader-quiz-${uuidv7()}`,
      title: "Bonding quiz",
      description: "Six questions.",
      status: "published",
    });
    quizId = quiz.id;
    quizSlug = quiz.slug;
  });

  /**
   * Current against the source, before every test.
   *
   * One of these tests deliberately moves the source on. Without this the
   * next test to run sees a stale translation and fails for the previous
   * test's reason — which is what `--sequence.shuffle` found.
   */
  beforeEach(async () => {
    const currentHash = sql`(select source_hash from quizzes where id = ${quizId})`;
    await db
      .insert(schema.quizTranslations)
      .values({
        quizId,
        locale: "ar",
        title: "اختبار الروابط",
        description: "ستة أسئلة.",
        status: "published",
        sourceHash: currentHash,
      })
      .onConflictDoUpdate({
        target: [
          schema.quizTranslations.quizId,
          schema.quizTranslations.locale,
        ],
        set: { status: "published", sourceHash: currentHash },
      });
  });

  afterAll(async () => {
    await db.delete(schema.quizzes).where(eq(schema.quizzes.id, quizId));
  });

  const arabicRow = async () =>
    (await listQuizzes("ar")).find((row) => row.slug === quizSlug);

  it("serves a current translation, same as a lesson", async () => {
    const row = await arabicRow();
    expect(row?.title).toBe("اختبار الروابط");
    expect(row?.isTranslated).toBe(true);
  });

  it("falls back to English once the source moves on", async () => {
    // Unique per run: rewriting the same words is not an edit, and the
    // generated hash would not move.
    await db
      .update(schema.quizzes)
      .set({ description: `Six questions, revised ${uuidv7()}.` })
      .where(eq(schema.quizzes.id, quizId));

    const row = await arabicRow();

    // No notice, no stale Arabic: a quiz page has nowhere to put a caveat,
    // and a stale question may no longer match the options it is scored
    // against. This is the same database state that leaves a LESSON in Arabic
    // with a notice — the policy is what differs, not the data.
    expect(row?.title).toBe("Bonding quiz");
    expect(row?.isTranslated).toBe(false);
  });
});
