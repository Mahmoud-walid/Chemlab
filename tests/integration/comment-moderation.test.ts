import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import {
  listReportQueue,
  openReportCount,
  reportComment,
  resolveReports,
  setStatus,
} from "@/db/queries/comments";

/**
 * The moderation queue, against real Postgres.
 *
 * The aggregation is the part worth proving here: the queue groups reports by
 * comment, counts them, and orders by the OLDEST report — none of which a mock
 * would settle, and all of which decide what a moderator sees first.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

const AUTHOR = `mod-author-${uuidv7()}`;
const REPORTER_A = `mod-a-${uuidv7()}`;
const REPORTER_B = `mod-b-${uuidv7()}`;
const USERS = [AUTHOR, REPORTER_A, REPORTER_B];

let lessonId: string;

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  for (const id of USERS) {
    await db
      .insert(schema.users)
      .values({
        id,
        name: `User ${id.slice(-4)}`,
        email: `${id}@moderation.invalid`,
      })
      .onConflictDoNothing();
  }

  const [lesson] = await db
    .select({ id: schema.lessons.id })
    .from(schema.lessons)
    .limit(1);
  lessonId = lesson!.id;
});

afterAll(async () => {
  await db
    .delete(schema.comments)
    .where(eq(schema.comments.subjectId, lessonId));
  for (const id of USERS) {
    await db.delete(schema.users).where(eq(schema.users.id, id));
  }
  await close?.();
});

beforeEach(async () => {
  await db
    .delete(schema.comments)
    .where(eq(schema.comments.subjectId, lessonId));
});

async function comment(body: string) {
  const id = uuidv7();
  await db.insert(schema.comments).values({
    id,
    subjectType: "lesson",
    subjectId: lessonId,
    authorId: AUTHOR,
    body,
    depth: 0,
    path: id,
  });
  return id;
}

describe("the queue", () => {
  it("groups several reports into one row, counted", async () => {
    // Two people reporting one comment is one thing to look at, not two — and
    // the count is what tells a moderator it is a pile-on rather than a grudge.
    const id = await comment("Contentious");
    await reportComment(db, id, REPORTER_A, "spam");
    await reportComment(db, id, REPORTER_B, "abuse");

    const queue = await listReportQueue(db);
    const row = queue.find((entry) => entry.commentId === id);

    expect(row).toBeDefined();
    expect(row!.reportCount).toBe(2);
    expect([...row!.reasons].sort()).toEqual(["abuse", "spam"]);
  });

  it("shows the body even when the comment is a tombstone", async () => {
    // Unlike every public read. A moderator deciding whether somebody keeps
    // their account needs to see what was written, which is what `comment:read`
    // buys — and why the page is guarded rather than merely unlinked.
    const id = await comment("What was said");
    await reportComment(db, id, REPORTER_A, "abuse");
    await db
      .update(schema.comments)
      .set({ deletedAt: new Date() })
      .where(eq(schema.comments.id, id));

    const queue = await listReportQueue(db);
    expect(queue.find((entry) => entry.commentId === id)?.body).toBe(
      "What was said",
    );
  });

  it("puts the oldest complaint first", async () => {
    // A newest-first queue is one where the oldest complaint is never reached.
    const older = await comment("Reported first");
    const newer = await comment("Reported later");

    await reportComment(db, older, REPORTER_A, "spam");
    await db
      .update(schema.commentReports)
      .set({ createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) })
      .where(eq(schema.commentReports.commentId, older));
    await reportComment(db, newer, REPORTER_A, "spam");

    const queue = await listReportQueue(db);
    const positions = [older, newer].map((id) =>
      queue.findIndex((entry) => entry.commentId === id),
    );
    expect(positions[0]).toBeLessThan(positions[1]!);
  });

  it("keeps a hidden comment in the queue until its reports are resolved", async () => {
    // Hiding and resolving are different acts: a comment can be hidden while
    // the report is still open, and the queue is about the REPORT.
    const id = await comment("Hidden but unresolved");
    await reportComment(db, id, REPORTER_A, "spam");
    await setStatus(db, id, "hidden");

    const queue = await listReportQueue(db);
    const row = queue.find((entry) => entry.commentId === id);
    expect(row?.status).toBe("hidden");
  });
});

describe("resolving", () => {
  it("closes every open report on the comment, and only those", async () => {
    const id = await comment("Settled");
    const other = await comment("Still open");
    await reportComment(db, id, REPORTER_A, "spam");
    await reportComment(db, id, REPORTER_B, "abuse");
    await reportComment(db, other, REPORTER_A, "spam");

    expect(await resolveReports(db, id, REPORTER_B)).toBe(2);

    const queue = await listReportQueue(db);
    expect(queue.find((entry) => entry.commentId === id)).toBeUndefined();
    expect(queue.find((entry) => entry.commentId === other)).toBeDefined();
  });

  it("is idempotent — a second pass closes nothing", async () => {
    // Two moderators pressing the same button must not each claim to have
    // resolved it, or the audit trail says it happened twice.
    const id = await comment("Settled once");
    await reportComment(db, id, REPORTER_A, "spam");

    expect(await resolveReports(db, id, REPORTER_B)).toBe(1);
    expect(await resolveReports(db, id, REPORTER_B)).toBe(0);
  });

  it("records who settled it", async () => {
    const id = await comment("Who closed this");
    await reportComment(db, id, REPORTER_A, "spam");
    await resolveReports(db, id, REPORTER_B);

    const [row] = await db
      .select({ resolvedBy: schema.commentReports.resolvedBy })
      .from(schema.commentReports)
      .where(eq(schema.commentReports.commentId, id));
    expect(row!.resolvedBy).toBe(REPORTER_B);
  });
});

describe("the badge", () => {
  it("counts open reports, not comments", async () => {
    // Two reports on one comment is two things somebody complained about, and
    // the badge is about attention owed rather than rows in a table.
    const before = await openReportCount(db);
    const id = await comment("Twice reported");
    await reportComment(db, id, REPORTER_A, "spam");
    await reportComment(db, id, REPORTER_B, "abuse");

    expect(await openReportCount(db)).toBe(before + 2);

    await resolveReports(db, id, REPORTER_A);
    expect(await openReportCount(db)).toBe(before);
  });
});
