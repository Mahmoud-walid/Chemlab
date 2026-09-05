import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import {
  USER_LIST_SPEC,
  getUserDetail,
  getUserTimeline,
  listUsers,
} from "@/db/queries/admin/users";
import { parseListParams } from "@/db/queries/admin/list-params";

/**
 * The per-user admin view, against real Postgres.
 *
 * The claim that needs a real database is the keyset pagination: it exists so
 * a timeline stays stable while new events arrive, and the only way to show
 * that is to insert events between two page reads and check nothing was
 * skipped or repeated.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

const USER = `users-suite-${uuidv7()}`;
const OTHER = `users-suite-other-${uuidv7()}`;
const EMAIL = `${USER}@users.invalid`;

let quizId: string;

const list = () => parseListParams({}, USER_LIST_SPEC);

/** Events land with distinct timestamps unless a test wants otherwise. */
async function event(
  verb: string,
  createdAt: Date,
  actorId: string = USER,
): Promise<string> {
  const id = uuidv7();
  await db.insert(schema.activityEvents).values({
    id,
    actorId,
    verb: verb as never,
    objectType: "lesson",
    objectId: "x",
    createdAt,
  });
  return id;
}

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  for (const [id, email] of [
    [USER, EMAIL],
    [OTHER, `${OTHER}@users.invalid`],
  ] as const) {
    await db.insert(schema.users).values({
      id,
      name: id === USER ? "Suite Subject" : "Suite Other",
      email,
      emailVerified: true,
    });
  }

  await db.insert(schema.profiles).values({
    userId: USER,
    displayName: "Suite Subject",
    bio: "Created by tests/integration/admin-users.test.ts.",
  });

  const [memberRole] = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(eq(schema.roles.key, "member"));
  await db
    .insert(schema.userRoles)
    .values({ userId: USER, roleId: memberRole!.id });

  quizId = uuidv7();
  await db.insert(schema.quizzes).values({
    id: quizId,
    slug: "users-suite-quiz",
    title: "Users suite quiz",
    description: "Created by tests/integration/admin-users.test.ts.",
    difficulty: "easy",
    category: "Testing",
    status: "published",
    passMarkPercent: 50,
  });
});

afterAll(async () => {
  await db
    .delete(schema.activityEvents)
    .where(inArray(schema.activityEvents.actorId, [USER, OTHER]));
  await db.delete(schema.quizzes).where(eq(schema.quizzes.id, quizId));
  await db.delete(schema.users).where(inArray(schema.users.id, [USER, OTHER]));
  await close?.();
});

describe("the user list", () => {
  it("finds a person by email", async () => {
    const page = await listUsers(list(), EMAIL);
    expect(page.rows.map((row) => row.id)).toContain(USER);
    expect(page.total).toBe(1);
  });

  it("finds a person by name, case-insensitively", async () => {
    const page = await listUsers(list(), "suite subject");
    expect(page.rows.map((row) => row.id)).toContain(USER);
  });

  it("carries their roles without a query per row", async () => {
    // Aggregated in SQL: 25 extra round trips to render a column of badges is
    // how a list page ends up taking a second to draw.
    const page = await listUsers(list(), EMAIL);
    expect(page.rows[0]!.roleKeys).toEqual(["member"]);
  });

  it("returns an empty page rather than everything for a search that matches nothing", async () => {
    const page = await listUsers(list(), "no-such-person-anywhere");
    expect(page.rows).toEqual([]);
    expect(page.total).toBe(0);
  });
});

describe("one person's record", () => {
  it("returns nothing for an unknown id", async () => {
    expect(await getUserDetail("no-such-user")).toBeNull();
  });

  it("counts their activity by verb", async () => {
    await event("lesson.viewed", new Date("2026-01-01T10:00:00Z"));
    await event("lesson.viewed", new Date("2026-01-01T10:01:00Z"));
    await event("lesson.completed", new Date("2026-01-01T10:02:00Z"));
    await event("comment.posted", new Date("2026-01-01T10:03:00Z"));
    // Somebody else's events must not land in this person's counts.
    await event("lesson.viewed", new Date("2026-01-01T10:04:00Z"), OTHER);

    const detail = (await getUserDetail(USER))!;
    expect(detail.counts.lessonsViewed).toBe(2);
    expect(detail.counts.lessonsCompleted).toBe(1);
    expect(detail.counts.comments).toBe(1);
  });

  it("counts exams from attempts, not from events", async () => {
    // The attempt row is authoritative. An event stream can lose a
    // fire-and-forget write, and a score rebuilt from one would be a second
    // answer to a question that already has an authoritative one.
    await db.insert(schema.examAttempts).values({
      id: uuidv7(),
      quizId,
      userId: USER,
      attemptNumber: 1,
      seed: 1,
      quizRevision: new Date(),
      status: "submitted",
      score: 4,
      maxScore: 8,
      passed: true,
      submittedAt: new Date("2026-01-02T10:00:00Z"),
    });
    await db.insert(schema.examAttempts).values({
      id: uuidv7(),
      quizId,
      userId: USER,
      attemptNumber: 2,
      seed: 2,
      quizRevision: new Date(),
      status: "submitted",
      score: 2,
      maxScore: 8,
      passed: false,
      submittedAt: new Date("2026-01-03T10:00:00Z"),
    });

    const detail = (await getUserDetail(USER))!;
    expect(detail.counts.examsTaken).toBe(2);
    expect(detail.counts.examsPassed).toBe(1);

    const result = detail.quizzes.find(
      (entry) => entry.quizSlug === "users-suite-quiz",
    )!;
    expect(result.attempts).toBe(2);
    // Best is the best, latest is the latest — reporting one number would
    // hide either the improvement or the regression.
    expect(result.bestPercent).toBe(50);
    expect(result.latestPercent).toBe(25);
    expect(result.passed).toBe(true);
  });

  it("leaves a voided sitting out of their record", async () => {
    // A struck-out attempt must not be somebody's best score.
    await db.insert(schema.examAttempts).values({
      id: uuidv7(),
      quizId,
      userId: USER,
      attemptNumber: 3,
      seed: 3,
      quizRevision: new Date(),
      status: "voided",
      voidReason: "suite",
      score: 8,
      maxScore: 8,
      passed: true,
      submittedAt: new Date("2026-01-04T10:00:00Z"),
    });

    const detail = (await getUserDetail(USER))!;
    const result = detail.quizzes.find(
      (entry) => entry.quizSlug === "users-suite-quiz",
    )!;
    expect(result.attempts).toBe(2);
    expect(result.bestPercent).toBe(50);
  });
});

describe("the timeline", () => {
  it("returns this person's events, newest first", async () => {
    const page = await getUserTimeline(USER, { limit: 50 });
    expect(page.entries.length).toBeGreaterThan(0);
    for (let i = 1; i < page.entries.length; i++) {
      expect(page.entries[i - 1]!.createdAt.getTime()).toBeGreaterThanOrEqual(
        page.entries[i]!.createdAt.getTime(),
      );
    }
  });

  it("never carries the PII columns", async () => {
    // This timeline is shown to any reader with `activity:read`. The IP and
    // user agent need `activity:read_pii` and are served by the query that
    // gates them in its SELECT.
    const page = await getUserTimeline(USER, { limit: 5 });
    const payload = JSON.stringify(page);
    expect(payload).not.toContain("ipAddress");
    expect(payload).not.toContain("userAgent");
  });

  it("pages with a cursor, without repeating or skipping", async () => {
    const first = await getUserTimeline(USER, { limit: 2 });
    expect(first.nextCursor).not.toBeNull();

    const second = await getUserTimeline(USER, {
      limit: 2,
      cursor: first.nextCursor!,
    });

    const firstIds = first.entries.map((entry) => entry.id);
    const secondIds = second.entries.map((entry) => entry.id);
    expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);
  });

  it("stays stable when new events arrive between pages", async () => {
    // The reason this is keyset rather than OFFSET. With OFFSET, rows shift
    // down past the page boundary as new events land at the head, and the
    // reader silently never sees them.
    const first = await getUserTimeline(USER, { limit: 3 });
    const seen = new Set(first.entries.map((entry) => entry.id));

    // Three new events, all newer than everything already there.
    await event("lesson.liked", new Date());
    await event("lesson.liked", new Date(Date.now() + 1));
    await event("lesson.liked", new Date(Date.now() + 2));

    const second = await getUserTimeline(USER, {
      limit: 3,
      cursor: first.nextCursor!,
    });

    for (const entry of second.entries) {
      expect(seen.has(entry.id), `${entry.id} was returned twice`).toBe(false);
      // And every row on page two is genuinely older than page one's last.
      expect(entry.createdAt.getTime()).toBeLessThanOrEqual(
        first.entries[first.entries.length - 1]!.createdAt.getTime(),
      );
    }
  });

  it("separates events that share a timestamp", async () => {
    // Two events in the same millisecond are ordinary — a submit writes
    // several. A cursor on the timestamp alone would repeat or skip them.
    const shared = new Date("2026-02-01T00:00:00.000Z");
    await event("lesson.saved", shared);
    await event("lesson.saved", shared);
    await event("lesson.saved", shared);

    const collected: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 20; guard++) {
      const page = await getUserTimeline(USER, { limit: 2, cursor });
      collected.push(...page.entries.map((entry) => entry.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    expect(new Set(collected).size).toBe(collected.length);
  });

  it("starts from the top for a malformed cursor", async () => {
    // A stale link or a probe. A scroll position is not worth an error page.
    const page = await getUserTimeline(USER, { limit: 2, cursor: "nonsense" });
    expect(page.entries.length).toBe(2);
  });

  it("returns nothing for somebody with no events", async () => {
    const page = await getUserTimeline("no-such-user");
    expect(page.entries).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});
