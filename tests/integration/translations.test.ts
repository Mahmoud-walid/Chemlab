import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { isStale } from "@/db/queries/translations";
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

  for (const [id, name] of [
    [TRANSLATOR, "Translator"],
    [REVIEWER, "Reviewer"],
  ]) {
    await db
      .insert(schema.users)
      .values({ id, name, email: `${id}@example.test` })
      .onConflictDoNothing();
  }

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

async function translateInto(locale: string): Promise<void> {
  await db.insert(schema.lessonTranslations).values({
    lessonId,
    locale,
    title: "الأحماض والقواعد",
    description: "نظرة أولى.",
    status: "published",
    translatedBy: TRANSLATOR,
    // Read from the generated column, never recomputed here — the same rule
    // the application writers follow.
    sourceHash: sql`(select source_hash from lessons where id = ${lessonId})`,
  });
}

describe("staleness", () => {
  it("is false for a translation made from the source as it stands", async () => {
    await translateInto("ar");
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
