import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import {
  getLessonForAdmin,
  isSlugTaken,
  listLessonsForAdmin,
  nextLessonPosition,
  LESSON_LIST_SPEC,
} from "@/db/queries/admin/lessons";
import {
  getLessonBySlug,
  listLessonSlugs,
  listLessons,
} from "@/db/queries/lessons";
import { parseListParams } from "@/db/queries/admin/list-params";
import { publishBlockers } from "@/lib/admin/lesson-schema";

/**
 * The lesson lifecycle, against real Postgres.
 *
 * The acceptance criteria these exist for: a draft must be unreachable from
 * every public route, and a lesson with no body must not be publishable. Both
 * are claims about what SQL returns, so they are asserted against the real
 * query functions the pages call — not against a re-implementation of them,
 * which would pass even if the pages' own WHERE clause were wrong.
 *
 * The server ACTIONS need the Next.js runtime, so what is exercised here is
 * the pair that decides the outcome: the stored row, and the rules read from
 * it.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

/** A lesson this suite owns, so no seeded row is left in a changed state. */
const OWNED = {
  id: uuidv7(),
  slug: "suite-owned-draft",
  title: "A lesson the suite owns",
  description: "Created by tests/integration/admin-lessons.test.ts.",
  difficulty: "easy" as const,
  category: "Testing",
};

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  await db
    .insert(schema.lessons)
    .values({ ...OWNED, status: "draft", position: 9000 })
    .onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(schema.lessons).where(eq(schema.lessons.id, OWNED.id));
  await close?.();
});

const defaultList = () => parseListParams({}, LESSON_LIST_SPEC);

describe("a draft lesson", () => {
  it("is invisible to the public catalogue", async () => {
    const slugs = (await listLessons("en")).map((lesson) => lesson.slug);
    expect(slugs).not.toContain(OWNED.slug);
  });

  it("is unreachable by slug, so its route 404s", async () => {
    expect(await getLessonBySlug(OWNED.slug, "en")).toBeNull();
  });

  it("is absent from the prerender and sitemap slug list", async () => {
    expect(await listLessonSlugs()).not.toContain(OWNED.slug);
  });

  it("is visible in the admin list, which is the point of the screen", async () => {
    const { rows } = await listLessonsForAdmin(defaultList());
    expect(rows.map((row) => row.slug)).toContain(OWNED.slug);
  });

  it("is visible in the admin list filtered to drafts", async () => {
    const { rows } = await listLessonsForAdmin(defaultList(), "draft");
    expect(rows.map((row) => row.slug)).toContain(OWNED.slug);
    expect(rows.every((row) => row.status === "draft")).toBe(true);
  });

  it("is absent from the admin list filtered to published", async () => {
    const { rows } = await listLessonsForAdmin(defaultList(), "published");
    expect(rows.map((row) => row.slug)).not.toContain(OWNED.slug);
  });
});

describe("publishing", () => {
  it("is refused for a lesson with no sections, naming the reason", async () => {
    const lesson = await getLessonForAdmin(OWNED.slug);
    expect(lesson?.sectionCount).toBe(0);
    expect(publishBlockers(lesson!)).toEqual(["missingBody"]);
  });

  it("is allowed once the lesson has a section", async () => {
    const sectionId = uuidv7();
    await db.insert(schema.lessonSections).values({
      id: sectionId,
      lessonId: OWNED.id,
      position: 0,
      heading: "A section",
      body: [],
    });

    try {
      const lesson = await getLessonForAdmin(OWNED.slug);
      expect(lesson?.sectionCount).toBe(1);
      expect(publishBlockers(lesson!)).toEqual([]);
    } finally {
      await db
        .delete(schema.lessonSections)
        .where(eq(schema.lessonSections.id, sectionId));
    }
  });

  it("is refused for a withdrawn lesson even when it is otherwise complete", async () => {
    expect(
      publishBlockers({
        title: "t",
        description: "d",
        category: "c",
        sectionCount: 3,
        deletedAt: new Date(),
      }),
    ).toEqual(["deleted"]);
  });
});

describe("taking a published lesson back to draft", () => {
  const slug = "introduction-basics";
  let restored = true;

  afterEach(async () => {
    if (!restored) {
      await db
        .update(schema.lessons)
        .set({ status: "published" })
        .where(eq(schema.lessons.slug, slug));
      restored = true;
    }
  });

  it("removes it from the public catalogue and restores it on republish", async () => {
    expect((await listLessons("en")).map((l) => l.slug)).toContain(slug);

    restored = false;
    await db
      .update(schema.lessons)
      .set({ status: "draft" })
      .where(eq(schema.lessons.slug, slug));

    expect((await listLessons("en")).map((l) => l.slug)).not.toContain(slug);
    expect(await getLessonBySlug(slug, "en")).toBeNull();

    await db
      .update(schema.lessons)
      .set({ status: "published" })
      .where(eq(schema.lessons.slug, slug));
    restored = true;

    expect(await getLessonBySlug(slug, "en")).not.toBeNull();
  });
});

describe("slugs", () => {
  it("reports a slug already held by another lesson", async () => {
    expect(await isSlugTaken(OWNED.slug)).toBe(true);
  });

  it("does not report a lesson's own slug as taken when editing it", async () => {
    expect(await isSlugTaken(OWNED.slug, OWNED.id)).toBe(false);
  });

  it("is enforced by the database, not only by the check", async () => {
    // The check and the INSERT are not atomic, so the unique index is what
    // actually decides. If it were missing, two lessons could share a URL.
    await expect(
      db.insert(schema.lessons).values({
        id: uuidv7(),
        slug: OWNED.slug,
        title: "A duplicate",
        description: "Should not be storable.",
        difficulty: "easy",
        category: "Testing",
      }),
    ).rejects.toThrow();
  });
});

describe("the admin list", () => {
  it("orders by curriculum position rather than by slug", async () => {
    const { rows } = await listLessonsForAdmin(defaultList());
    const positions = rows.map((row) => row.position);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("counts sections per lesson", async () => {
    const { rows } = await listLessonsForAdmin(defaultList());
    const withBody = rows.find((row) => row.slug === "introduction-basics");
    expect(withBody?.sectionCount).toBeGreaterThan(0);
  });

  it("narrows to a search term", async () => {
    const { rows, total } = await listLessonsForAdmin(
      parseListParams({ q: "suite-owned" }, LESSON_LIST_SPEC),
    );
    expect(total).toBe(1);
    expect(rows[0]?.slug).toBe(OWNED.slug);
  });

  it("hides soft-deleted lessons, while the editor can still reach them", async () => {
    await db
      .update(schema.lessons)
      .set({ deletedAt: new Date(), status: "archived" })
      .where(eq(schema.lessons.id, OWNED.id));

    try {
      const { rows } = await listLessonsForAdmin(defaultList());
      expect(rows.map((row) => row.slug)).not.toContain(OWNED.slug);
      // Reachable by slug, because the editor is where it would be restored
      // from and a 404 there would leave no way back.
      expect(await getLessonForAdmin(OWNED.slug)).not.toBeNull();
    } finally {
      await db
        .update(schema.lessons)
        .set({ deletedAt: null, status: "draft" })
        .where(eq(schema.lessons.id, OWNED.id));
    }
  });
});

describe("nextLessonPosition", () => {
  it("lands a new lesson after every existing one", async () => {
    const next = await nextLessonPosition();
    const { rows } = await listLessonsForAdmin({
      ...defaultList(),
      pageSize: 100,
    });
    for (const row of rows) expect(next).toBeGreaterThan(row.position);
  });
});
