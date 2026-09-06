import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import {
  applyBulkLessons,
  lessonsForBulk,
} from "@/db/queries/admin/bulk-lessons";
import { isWritable, planBulk, refusedResult } from "@/lib/admin/bulk";
import { createLesson, createUser } from "../factories";
import { publishBlockers } from "@/lib/admin/lesson-schema";

/**
 * A bulk action against real Postgres.
 *
 * The criterion is about the DATABASE: one transaction, one audit entry per
 * row, all of it or none of it. A mock would confirm the mock — and the
 * failure this guards against is forty lessons of which nineteen were
 * archived and nobody knows which.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

const ACTOR = `bulk-actor-${uuidv7()}`;
let ids: string[] = [];

async function lesson(
  name: string,
  overrides: Partial<{
    status: "draft" | "published" | "archived";
    sections: number;
  }> = {},
): Promise<string> {
  const { id } = await createLesson(db, {
    slug: `bulk-${uuidv7()}`,
    title: `Lesson ${name}`,
    description: "For the bulk tests.",
    status: overrides.status ?? "draft",
    // One by default: a lesson with no sections cannot be published, and most
    // of these tests are about publishing.
    sections: overrides.sections ?? 1,
  });
  ids.push(id);
  return id;
}

const auditFor = async (lessonIds: string[]) =>
  db
    .select({
      targetId: schema.auditLog.targetId,
      action: schema.auditLog.action,
      after: schema.auditLog.after,
    })
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.actorId, ACTOR),
        inArray(schema.auditLog.targetId, lessonIds),
      ),
    );

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));
  await createUser(db, { id: ACTOR, name: "Bulk actor" });
});

afterAll(async () => {
  // The actor is deliberately NOT deleted. `audit_log.actor_id` is
  // `on delete set null`, and the audit log carries a BEFORE DELETE OR UPDATE
  // trigger that refuses both — so deleting an actor who has audited anything
  // fails. That is a real conflict between two rules, recorded as Q40 in
  // docs/DEFERRED_QUESTIONS.md; it is not this suite's to resolve, and
  // leaving one test user behind costs nothing.
  await db
    .delete(schema.lessons)
    .where(sql`${schema.lessons.slug} like 'bulk-%'`);
  await close?.();
});

beforeEach(() => {
  ids = [];
});

describe("applyBulkLessons", () => {
  it("writes one audit entry per row, marked as a batch", async () => {
    const a = await lesson("A");
    const b = await lesson("B");

    await applyBulkLessons(ACTOR, await lessonsForBulk([a, b]), "archive");

    const entries = await auditFor([a, b]);
    // One per row. "Somebody archived forty lessons" is not an answer to
    // "who archived this lesson", and the log is read one row at a time.
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.targetId).sort()).toEqual(
      [a, b].sort(),
    );
    for (const entry of entries) {
      expect(entry.action).toBe("lesson.archived");
      // So the log can tell a batch from forty deliberate single actions.
      expect(entry.after).toMatchObject({ bulk: true });
    }
  });

  it("sets publishedAt on the first publish and never moves it after", async () => {
    const id = await lesson("first");
    await applyBulkLessons(ACTOR, await lessonsForBulk([id]), "publish");

    const [first] = await lessonsForBulk([id]);
    expect(first?.publishedAt).toBeInstanceOf(Date);

    await applyBulkLessons(ACTOR, await lessonsForBulk([id]), "archive");
    await applyBulkLessons(ACTOR, await lessonsForBulk([id]), "publish");

    const [again] = await lessonsForBulk([id]);
    // `published_at` records when a lesson FIRST went live. Re-publishing
    // must not rewrite that — it is the only record of the original date.
    expect(again?.publishedAt?.getTime()).toBe(first?.publishedAt?.getTime());
  });

  it("withdraws by soft-deleting and archiving together", async () => {
    const id = await lesson("withdrawn", { status: "published" });
    await applyBulkLessons(ACTOR, await lessonsForBulk([id]), "withdraw");

    const [row] = await lessonsForBulk([id]);
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect(row?.status).toBe("archived");
  });

  it("leaves nothing behind when the transaction fails", async () => {
    const a = await lesson("kept");
    const b = await lesson("kept too");
    const rows = await lessonsForBulk([a, b]);

    // A row whose id is not a uuid fails the UPDATE mid-transaction. The
    // point is what the OTHER rows look like afterwards.
    await expect(
      applyBulkLessons(
        ACTOR,
        [...rows, { ...rows[0]!, id: "not-a-uuid" }],
        "archive",
      ),
    ).rejects.toThrow();

    const after = await lessonsForBulk([a, b]);
    expect(after.map((row) => row.status)).toEqual(["draft", "draft"]);
    // And no audit entry survives either — a log of work that was rolled back
    // is worse than no log.
    expect(await auditFor([a, b])).toHaveLength(0);
  });
});

describe("planning a batch", () => {
  it("refuses the whole batch for one unpublishable lesson, naming it", async () => {
    const good = await lesson("publishable");
    const empty = await lesson("empty", { sections: 0 });

    const found = await lessonsForBulk([good, empty]);
    const plan = planBulk([good, empty], found, (row) => {
      const blockers = publishBlockers(row);
      return blockers.length > 0 ? { refuse: blockers } : {};
    });

    expect(isWritable(plan)).toBe(false);
    expect(plan.refused).toHaveLength(1);
    expect(plan.refused[0]?.label).toBe("Lesson empty");
    expect(plan.refused[0]?.detail).toContain("missingBody");

    // And nothing was written, which is the whole point of planning first.
    expect(refusedResult(plan).applied).toBe(0);
    expect((await lessonsForBulk([good]))[0]?.status).toBe("draft");
  });

  it("counts a lesson already published as unchanged, not refused", async () => {
    const live = await lesson("live", { status: "published" });
    const draft = await lesson("draft");

    const found = await lessonsForBulk([live, draft]);
    const plan = planBulk([live, draft], found, (row) => {
      const blockers = publishBlockers(row);
      if (blockers.length > 0) return { refuse: blockers };
      return { skip: row.status === "published" };
    });

    expect(plan.unchanged).toEqual([live]);
    expect(plan.apply).toEqual([draft]);
    expect(isWritable(plan)).toBe(true);
  });

  it("refuses a selected id the database no longer has", async () => {
    const kept = await lesson("kept");
    const vanished = uuidv7();

    const found = await lessonsForBulk([kept, vanished]);
    const plan = planBulk([kept, vanished], found, () => ({}));

    // Deleted by somebody else between the page render and the click.
    // Silently dropping it would let a stale selection quietly shrink the
    // action.
    expect(plan.refused.map((row) => row.id)).toEqual([vanished]);
    expect(isWritable(plan)).toBe(false);
  });
});
