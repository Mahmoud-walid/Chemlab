import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import {
  dailySeries,
  funnelCounts,
  isoDay,
  quizAttemptSeries,
  rollUpDay,
  startOfDay,
  topObjects,
} from "@/db/queries/admin/rollup";

/**
 * The dashboard's data path, against real Postgres.
 *
 * Two claims need a real database. **Idempotency**: running the same day twice
 * must produce identical rows, or a backfill becomes something nobody dares
 * repeat. And **the rollup/live split**: closed days come from the rollup,
 * today is counted live, and a dashboard that reads only the rollup looks
 * broken every morning.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

const USERS = [`rollup-a-${uuidv7()}`, `rollup-b-${uuidv7()}`];
const DAY = "2026-03-01";
const NEXT = "2026-03-02";

let quizId: string;

async function event(
  verb: string,
  createdAt: string,
  actorId: string,
  objectId?: string,
) {
  await db.insert(schema.activityEvents).values({
    id: uuidv7(),
    actorId,
    verb: verb as never,
    objectType: objectId ? "lesson" : null,
    objectId: objectId ?? null,
    createdAt: new Date(createdAt),
  });
}

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  for (const id of USERS) {
    await db.insert(schema.users).values({
      id,
      name: "Rollup suite",
      email: `${id}@rollup.invalid`,
      emailVerified: true,
    });
  }

  quizId = uuidv7();
  await db.insert(schema.quizzes).values({
    id: quizId,
    slug: "rollup-suite-quiz",
    title: "Rollup suite quiz",
    description: "Created by tests/integration/rollup.test.ts.",
    difficulty: "easy",
    category: "Testing",
    status: "published",
    passMarkPercent: 50,
  });
});

afterAll(async () => {
  await db
    .delete(schema.activityEvents)
    .where(inArray(schema.activityEvents.actorId, USERS));
  await db.delete(schema.quizzes).where(eq(schema.quizzes.id, quizId));
  await db.delete(schema.users).where(inArray(schema.users.id, USERS));
  await db
    .delete(schema.activityDailyRollup)
    .where(inArray(schema.activityDailyRollup.day, [DAY, NEXT]));
  await close?.();
});

afterEach(async () => {
  await db
    .delete(schema.activityDailyRollup)
    .where(inArray(schema.activityDailyRollup.day, [DAY, NEXT]));
  await db
    .delete(schema.activityEvents)
    .where(inArray(schema.activityEvents.actorId, USERS));
});

/** The rollup rows for the suite's day, in a stable order. */
async function rollupRows(day = DAY) {
  return db
    .select({
      verb: schema.activityDailyRollup.verb,
      objectType: schema.activityDailyRollup.objectType,
      objectId: schema.activityDailyRollup.objectId,
      eventCount: schema.activityDailyRollup.eventCount,
      uniqueActors: schema.activityDailyRollup.uniqueActors,
    })
    .from(schema.activityDailyRollup)
    .where(eq(schema.activityDailyRollup.day, day))
    .orderBy(
      schema.activityDailyRollup.verb,
      schema.activityDailyRollup.objectId,
    );
}

describe("rolling up a day", () => {
  it("counts events and distinct people per verb and object", async () => {
    await event("lesson.viewed", `${DAY}T09:00:00Z`, USERS[0]!, "atoms");
    await event("lesson.viewed", `${DAY}T10:00:00Z`, USERS[0]!, "atoms");
    await event("lesson.viewed", `${DAY}T11:00:00Z`, USERS[1]!, "atoms");

    await rollUpDay(DAY);
    const rows = await rollupRows();
    const atoms = rows.find((row) => row.objectId === "atoms")!;

    expect(atoms.eventCount).toBe(3);
    // Two people, three views. One person reading a lesson twice is one
    // person, which is the whole reason both columns exist.
    expect(atoms.uniqueActors).toBe(2);
  });

  it("is idempotent — the same day twice gives identical rows", async () => {
    // The property that makes a backfill safe to repeat. `ON CONFLICT DO
    // UPDATE` rather than delete-then-insert, so the table is never
    // momentarily missing a day a dashboard could read.
    await event("lesson.viewed", `${DAY}T09:00:00Z`, USERS[0]!, "atoms");
    await event("comment.posted", `${DAY}T09:30:00Z`, USERS[1]!);

    await rollUpDay(DAY);
    const first = await rollupRows();

    await rollUpDay(DAY);
    const second = await rollupRows();

    expect(second).toEqual(first);
  });

  it("re-counts rather than accumulating when events change", async () => {
    // An incremental rollup would have to know what it had already counted,
    // and the first time that bookkeeping is wrong every number after it is
    // wrong with no way to notice. This recomputes the whole day.
    await event("lesson.viewed", `${DAY}T09:00:00Z`, USERS[0]!, "atoms");
    await rollUpDay(DAY);
    expect((await rollupRows())[0]!.eventCount).toBe(1);

    await event("lesson.viewed", `${DAY}T10:00:00Z`, USERS[0]!, "atoms");
    await rollUpDay(DAY);
    expect((await rollupRows())[0]!.eventCount).toBe(2);
  });

  it("stores an objectless event under the empty string, not null", async () => {
    // A null in a primary key compares as distinct in Postgres, so a nullable
    // column here would let the same row insert twice and silently break the
    // idempotency above.
    await event("auth.signed_up", `${DAY}T08:00:00Z`, USERS[0]!);
    await rollUpDay(DAY);

    const rows = await rollupRows();
    const signup = rows.find((row) => row.verb === "auth.signed_up")!;
    expect(signup.objectType).toBe("");
    expect(signup.objectId).toBe("");

    // And running it again does not duplicate that row.
    await rollUpDay(DAY);
    const after = await rollupRows();
    expect(after.filter((row) => row.verb === "auth.signed_up")).toHaveLength(
      1,
    );
  });

  it("does not pull in the next day's events", async () => {
    await event("lesson.viewed", `${DAY}T23:59:59Z`, USERS[0]!, "atoms");
    await event("lesson.viewed", `${NEXT}T00:00:01Z`, USERS[0]!, "atoms");

    await rollUpDay(DAY);
    expect((await rollupRows())[0]!.eventCount).toBe(1);
  });

  it("writes nothing for a day with no events", async () => {
    await rollUpDay(DAY);
    expect(await rollupRows()).toEqual([]);
  });

  it("counts an anonymous event toward the total but toward nobody", async () => {
    await db.insert(schema.activityEvents).values({
      id: uuidv7(),
      actorId: null,
      verb: "lesson.viewed",
      objectType: "lesson",
      objectId: "anon-probe",
      createdAt: new Date(`${DAY}T12:00:00Z`),
    });

    await rollUpDay(DAY);
    const row = (await rollupRows()).find(
      (entry) => entry.objectId === "anon-probe",
    )!;
    expect(row.eventCount).toBe(1);
    // `count(distinct actor_id)` ignores nulls, which is the honest reading of
    // "unique actors" — an anonymous event is not a person we can count.
    expect(row.uniqueActors).toBe(0);

    await db
      .delete(schema.activityEvents)
      .where(eq(schema.activityEvents.objectId, "anon-probe"));
  });
});

describe("reading a series", () => {
  it("fills a quiet day with a zero rather than skipping it", async () => {
    // A line chart that skips empty days draws a straight line across a quiet
    // week and reads as steady traffic.
    await event("lesson.viewed", `${DAY}T09:00:00Z`, USERS[0]!, "atoms");
    await rollUpDay(DAY);

    const points = await dailySeries(
      ["lesson.viewed"],
      new Date(`${DAY}T00:00:00Z`),
      new Date(`2026-03-05T00:00:00Z`),
    );

    expect(points).toHaveLength(5);
    expect(points[0]).toEqual({ day: DAY, count: 1 });
    expect(points.slice(1).every((point) => point.count === 0)).toBe(true);
  });

  it("counts today live, since today has no rollup row", async () => {
    // Today is not a closed day. A dashboard reading only the rollup would be
    // a day stale and look broken every morning.
    const today = isoDay(startOfDay(new Date()));
    await event("comment.posted", new Date().toISOString(), USERS[0]!);

    const points = await dailySeries(
      ["comment.posted"],
      startOfDay(new Date()),
      startOfDay(new Date()),
    );

    const point = points.find((entry) => entry.day === today)!;
    expect(point.count).toBeGreaterThanOrEqual(1);
  });
});

describe("ranking objects", () => {
  it("orders by event count across the range", async () => {
    await event("lesson.viewed", `${DAY}T09:00:00Z`, USERS[0]!, "popular");
    await event("lesson.viewed", `${DAY}T09:30:00Z`, USERS[1]!, "popular");
    await event("lesson.viewed", `${DAY}T10:00:00Z`, USERS[0]!, "quiet");
    await rollUpDay(DAY);

    const ranked = await topObjects(
      ["lesson.viewed"],
      "lesson",
      new Date(`${DAY}T00:00:00Z`),
    );
    const ids = ranked.map((row) => row.objectId);
    expect(ids.indexOf("popular")).toBeLessThan(ids.indexOf("quiet"));
  });
});

describe("the funnel", () => {
  const from = new Date(`${DAY}T00:00:00Z`);
  const to = new Date(`2026-03-10T00:00:00Z`);

  it("counts distinct people, not events", async () => {
    // Somebody reading forty lessons is one person who reached that stage.
    await event("auth.signed_up", `${DAY}T08:00:00Z`, USERS[0]!);
    await event("auth.signed_up", `${DAY}T08:05:00Z`, USERS[1]!);
    await event("lesson.viewed", `${DAY}T09:00:00Z`, USERS[0]!, "a");
    await event("lesson.viewed", `${DAY}T09:01:00Z`, USERS[0]!, "b");
    await event("lesson.viewed", `${DAY}T09:02:00Z`, USERS[0]!, "c");

    const rows = await funnelCounts(from, to);
    expect(rows.find((row) => row.key === "registered")!.people).toBe(2);
    expect(rows.find((row) => row.key === "lessonRead")!.people).toBe(1);
    expect(rows.find((row) => row.key === "lessonRead")!.conversion).toBe(50);
  });

  it("counts sittings from attempts, and narrows at each stage", async () => {
    await event("auth.signed_up", `${DAY}T08:00:00Z`, USERS[0]!);
    await event("auth.signed_up", `${DAY}T08:05:00Z`, USERS[1]!);

    // Two people start, one submits, and that one passes.
    await db.insert(schema.examAttempts).values({
      id: uuidv7(),
      quizId,
      userId: USERS[0]!,
      attemptNumber: 1,
      seed: 1,
      quizRevision: new Date(),
      status: "submitted",
      score: 8,
      maxScore: 10,
      passed: true,
      startedAt: new Date(`${DAY}T10:00:00Z`),
      submittedAt: new Date(`${DAY}T10:20:00Z`),
    });
    await db.insert(schema.examAttempts).values({
      id: uuidv7(),
      quizId,
      userId: USERS[1]!,
      attemptNumber: 1,
      seed: 2,
      quizRevision: new Date(),
      status: "in_progress",
      startedAt: new Date(`${DAY}T10:05:00Z`),
    });

    const rows = await funnelCounts(from, to);
    expect(rows.find((row) => row.key === "examStarted")!.people).toBe(2);
    expect(rows.find((row) => row.key === "examSubmitted")!.people).toBe(1);
    expect(rows.find((row) => row.key === "passed")!.people).toBe(1);
    // Half of those who started finished; all of those who finished passed.
    expect(rows.find((row) => row.key === "examSubmitted")!.conversion).toBe(
      50,
    );
    expect(rows.find((row) => row.key === "passed")!.conversion).toBe(100);

    await db
      .delete(schema.examAttempts)
      .where(eq(schema.examAttempts.quizId, quizId));
  });
});

describe("per-quiz attempts", () => {
  it("reports attempts and pass rate from the authoritative table", async () => {
    await db.insert(schema.examAttempts).values({
      id: uuidv7(),
      quizId,
      userId: USERS[0]!,
      attemptNumber: 1,
      seed: 1,
      quizRevision: new Date(),
      status: "submitted",
      score: 8,
      maxScore: 10,
      passed: true,
      startedAt: new Date(`${DAY}T10:00:00Z`),
      submittedAt: new Date(`${DAY}T10:20:00Z`),
    });
    await db.insert(schema.examAttempts).values({
      id: uuidv7(),
      quizId,
      userId: USERS[1]!,
      attemptNumber: 1,
      seed: 2,
      quizRevision: new Date(),
      status: "submitted",
      score: 2,
      maxScore: 10,
      passed: false,
      startedAt: new Date(`${DAY}T11:00:00Z`),
      submittedAt: new Date(`${DAY}T11:20:00Z`),
    });

    const rows = await quizAttemptSeries(new Date(`${DAY}T00:00:00Z`));
    const row = rows.find((entry) => entry.slug === "rollup-suite-quiz")!;
    expect(row.attempts).toBe(2);
    expect(row.passRate).toBe(50);

    await db
      .delete(schema.examAttempts)
      .where(eq(schema.examAttempts.quizId, quizId));
  });

  it("lists a quiz nobody has sat, with no pass rate rather than zero", async () => {
    // 0% would claim everybody failed. Nobody sat it.
    const rows = await quizAttemptSeries(new Date(`${DAY}T00:00:00Z`));
    const row = rows.find((entry) => entry.slug === "rollup-suite-quiz")!;
    expect(row.attempts).toBe(0);
    expect(row.passRate).toBeNull();
  });
});
