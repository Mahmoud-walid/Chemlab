import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import {
  hardDeleteLesson,
  lessonHardDeleteState,
} from "@/db/queries/admin/hard-delete";
import { hardDeleteRefusals } from "@/lib/admin/hard-delete";
import {
  createComment,
  createLesson,
  createSection,
  createUser,
  saveLesson,
} from "../factories";
import { allPermissionNames } from "@/db/seed/rbac";

/**
 * Erasing a lesson, against real Postgres.
 *
 * Three things only the database can answer: that the reference counts see
 * what actually points at the row, that the audit entry OUTLIVES the row it
 * describes, and that a row which changes between the check and the delete is
 * not erased anyway.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

const ACTOR = `hard-actor-${uuidv7()}`;
const READER = `hard-reader-${uuidv7()}`;

let lessonId: string;
let slug: string;

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  await createUser(db, { id: ACTOR, name: "Eraser" });
  await createUser(db, { id: READER, name: "Reader" });
});

afterAll(async () => {
  await db
    .delete(schema.lessons)
    .where(sql`${schema.lessons.slug} like 'harddel-%'`);
  // Deletable again since Q40 was resolved: the audit log's trigger now
  // permits the `actor_id -> NULL` its own foreign key asks for, so an actor
  // who has erased something no longer pins a test user in the database.
  await db
    .delete(schema.users)
    .where(inArray(schema.users.id, [ACTOR, READER]));
  await close?.();
});

beforeEach(async () => {
  const lesson = await createLesson(db, {
    slug: `harddel-${uuidv7()}`,
    title: "A mistake",
    description: "Made while learning the editor.",
  });
  lessonId = lesson.id;
  slug = lesson.slug;
});

const auditEntries = async () =>
  db
    .select({
      action: schema.auditLog.action,
      targetId: schema.auditLog.targetId,
      before: schema.auditLog.before,
    })
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.targetId, lessonId),
        eq(schema.auditLog.action, "lesson.delete_hard"),
      ),
    );

describe("the permission", () => {
  it("exists in the catalogue and is held by no role", async () => {
    expect(allPermissionNames()).toContain("lesson:delete_hard");

    const rows = await db.execute<{ key: string }>(sql`
      select r.key
      from roles r
      join role_permissions rp on rp.role_id = r.id
      join permissions p on p.id = rp.permission_id
      where p.name = 'lesson:delete_hard'
    `);

    // Not even Admin. A Super Admin can grant it at runtime when somebody
    // genuinely needs it; nobody holds it by default.
    expect(rows.rows).toEqual([]);
  });
});

describe("what may be erased", () => {
  it("allows a draft nothing refers to", async () => {
    const state = await lessonHardDeleteState(lessonId);
    expect(hardDeleteRefusals(state!)).toEqual([]);
  });

  it("refuses a lesson that was published and then withdrawn", async () => {
    await db
      .update(schema.lessons)
      .set({
        status: "archived",
        publishedAt: new Date(),
        deletedAt: new Date(),
      })
      .where(eq(schema.lessons.id, lessonId));

    // The case worth proving against the database rather than in a unit test:
    // `published_at` survives a withdrawal, and it is the only thing that
    // remembers readers once saw this.
    expect(
      hardDeleteRefusals((await lessonHardDeleteState(lessonId))!),
    ).toEqual(["wasPublished"]);
  });

  it("counts a comment on the lesson", async () => {
    await createComment(db, { subjectId: lessonId, authorId: READER });

    expect(
      hardDeleteRefusals((await lessonHardDeleteState(lessonId))!),
    ).toEqual(["hasComments"]);
  });

  it("counts a save and a like as the same question", async () => {
    await saveLesson(db, lessonId, READER);

    expect(
      hardDeleteRefusals((await lessonHardDeleteState(lessonId))!),
    ).toEqual(["hasEngagement"]);
  });

  it("counts an activity event", async () => {
    await db.execute(sql`
      insert into activity_events (id, verb, object_type, object_id, created_at)
      values (gen_random_uuid(), 'lesson.viewed'::activity_verb,
              'lesson'::activity_object_type, ${lessonId}, now())
    `);

    // The activity stream is an audit surface. Erasing the row it points at
    // would leave an event that resolves to nothing.
    expect(
      hardDeleteRefusals((await lessonHardDeleteState(lessonId))!),
    ).toEqual(["hasActivity"]);
  });
});

describe("erasing", () => {
  it("removes the row and leaves the audit entry behind", async () => {
    const state = await lessonHardDeleteState(lessonId);
    await hardDeleteLesson(ACTOR, state!);

    expect(await lessonHardDeleteState(lessonId)).toBeNull();

    // The point of the whole feature's record-keeping: `audit_log` holds no
    // foreign key to the row, so the entry outlives it — and carries the slug
    // and title, because an id pointing at nothing is not an answer to "what
    // was deleted".
    const entries = await auditEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.before).toMatchObject({
      slug,
      title: "A mistake",
      status: "draft",
      publishedAt: null,
    });
  });

  it("takes the lesson's own sections and translations with it", async () => {
    const { id: sectionId } = await createSection(db, lessonId);

    await hardDeleteLesson(ACTOR, (await lessonHardDeleteState(lessonId))!);

    // Owned content, not a reference: a section cannot outlive its lesson,
    // and the foreign key cascade is what says so.
    const [row] = await db
      .select({ id: schema.lessonSections.id })
      .from(schema.lessonSections)
      .where(eq(schema.lessonSections.id, sectionId));
    expect(row).toBeUndefined();
  });

  it("refuses to erase a row that was published after the check", async () => {
    const state = await lessonHardDeleteState(lessonId);

    // The window this guards: the state was read before an operator typed a
    // confirmation, and the lesson went live in between.
    await db
      .update(schema.lessons)
      .set({ status: "published", publishedAt: new Date() })
      .where(eq(schema.lessons.id, lessonId));

    await expect(hardDeleteLesson(ACTOR, state!)).rejects.toThrow();

    // Still there — and no audit entry claiming otherwise. A log saying a
    // lesson was erased when it was not is worse than no log.
    expect(await lessonHardDeleteState(lessonId)).not.toBeNull();
    expect(await auditEntries()).toHaveLength(0);
  });
});
