import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { runRetention } from "@/db/queries/admin/retention";

/**
 * The retention job, against real Postgres and real rows aged by hand.
 *
 * This is the one job in the repository that deletes data nobody can get
 * back, so what it must be shown to do is specific: delete PAST the event
 * window, blank the personal columns past the shorter one, leave everything
 * inside both windows completely alone, and stay idempotent — running it
 * twice must not report the second run as work.
 *
 * The batching is exercised with a batch size of two against six rows, so the
 * loop actually iterates. A test that only ever fills one batch would pass
 * against a job that ignored its ceiling entirely.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

const ACTOR = `retention-suite-${uuidv7()}`;
const NOW = new Date(Date.UTC(2026, 8, 1));
const DAY = 24 * 60 * 60 * 1000;

/** An event this many days before NOW, with personal columns filled in. */
async function event(daysOld: number): Promise<string> {
  const id = uuidv7();
  await db.insert(schema.activityEvents).values({
    id,
    actorId: ACTOR,
    verb: "lesson.viewed",
    objectType: "lesson",
    objectId: `retention-${daysOld}`,
    ipAddress: "203.0.113.0",
    userAgent: "RetentionSuite/1.0",
    createdAt: new Date(NOW.getTime() - daysOld * DAY),
  });
  return id;
}

async function mine() {
  return db
    .select({
      id: schema.activityEvents.id,
      objectId: schema.activityEvents.objectId,
      ipAddress: schema.activityEvents.ipAddress,
      userAgent: schema.activityEvents.userAgent,
    })
    .from(schema.activityEvents)
    .where(eq(schema.activityEvents.actorId, ACTOR));
}

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  await db.insert(schema.users).values({
    id: ACTOR,
    name: "Retention suite",
    email: `${ACTOR}@retention.invalid`,
    emailVerified: true,
  });
});

afterEach(async () => {
  await db
    .delete(schema.activityEvents)
    .where(eq(schema.activityEvents.actorId, ACTOR));
});

afterAll(async () => {
  await db.delete(schema.users).where(eq(schema.users.id, ACTOR));
  await close?.();
});

describe("runRetention", () => {
  it("deletes past the event window and keeps everything inside it", async () => {
    await event(200);
    await event(181);
    const keep = await event(179);
    const fresh = await event(1);

    const run = await runRetention(db, { now: NOW, batchSize: 2 });

    expect(run.deleted).toBe(2);
    const left = await mine();
    expect(left.map((row) => row.id).sort()).toEqual([keep, fresh].sort());
  });

  it("blanks the personal columns past the shorter window, keeping the row", async () => {
    const old = await event(120);
    const recent = await event(30);

    const run = await runRetention(db, { now: NOW });

    expect(run.anonymised).toBe(1);
    const rows = await mine();
    // The EVENT survives: the counts behind the dashboards run for six months,
    // the personal data attached to them for three.
    expect(rows).toHaveLength(2);

    const anonymised = rows.find((row) => row.id === old)!;
    expect(anonymised.ipAddress).toBeNull();
    expect(anonymised.userAgent).toBeNull();

    const untouched = rows.find((row) => row.id === recent)!;
    expect(untouched.ipAddress).toBe("203.0.113.0");
    expect(untouched.userAgent).toBe("RetentionSuite/1.0");
  });

  it("is idempotent: a second run finds nothing left to do", async () => {
    await event(200);
    await event(120);
    await event(1);

    const first = await runRetention(db, { now: NOW, batchSize: 2 });
    expect(first.deleted).toBe(1);
    expect(first.anonymised).toBe(1);

    const second = await runRetention(db, { now: NOW, batchSize: 2 });
    // Not merely "no error". Zero, because the anonymise pass filters on the
    // columns still holding something — without that filter it would rewrite
    // the same blank rows on every run, for ever.
    expect(second).toMatchObject({ deleted: 0, anonymised: 0 });
  });

  it("iterates its batches rather than stopping after the first", async () => {
    for (const age of [200, 201, 202, 203, 204, 205]) await event(age);

    const run = await runRetention(db, { now: NOW, batchSize: 2 });

    expect(run.deleted).toBe(6);
    expect(await mine()).toHaveLength(0);
  });

  it("stops at the batch ceiling and says it left work behind", async () => {
    for (const age of [200, 201, 202, 203]) await event(age);

    const run = await runRetention(db, {
      now: NOW,
      batchSize: 1,
      maxBatches: 2,
    });

    expect(run.truncated).toBe(true);
    expect(run.deleted).toBe(2);
    // The remainder is not lost, just deferred — which is the point of the
    // ceiling: a job pointed at years of backlog finishes and exits.
    expect(await mine()).toHaveLength(2);
  });

  it("reports without writing under --dry-run", async () => {
    await event(200);
    await event(120);

    const run = await runRetention(db, { now: NOW, dryRun: true });

    expect(run).toMatchObject({ deleted: 1, anonymised: 1 });
    const rows = await mine();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.ipAddress !== null)).toBe(true);
  });

  it("refuses windows that would keep personal data longer than the events", async () => {
    // The silent failure this guards: every row old enough to anonymise would
    // already have been deleted, so the job would report success nightly while
    // enforcing nothing.
    await expect(
      runRetention(db, { now: NOW, eventDays: 90, piiDays: 180 }),
    ).rejects.toThrow(/Incoherent retention windows/);
  });

  it("touches nobody else's rows", async () => {
    const other = `retention-other-${uuidv7()}`;
    await db.insert(schema.users).values({
      id: other,
      name: "Bystander",
      email: `${other}@retention.invalid`,
      emailVerified: true,
    });
    const survivor = uuidv7();
    await db.insert(schema.activityEvents).values({
      id: survivor,
      actorId: other,
      verb: "lesson.viewed",
      ipAddress: "198.51.100.0",
      // Inside both windows, so nothing should reach it.
      createdAt: new Date(NOW.getTime() - DAY),
    });
    await event(200);

    await runRetention(db, { now: NOW });

    const [row] = await db
      .select({ ip: schema.activityEvents.ipAddress })
      .from(schema.activityEvents)
      .where(eq(schema.activityEvents.id, survivor));
    expect(row?.ip).toBe("198.51.100.0");

    await db
      .delete(schema.activityEvents)
      .where(eq(schema.activityEvents.actorId, other));
    await db.delete(schema.users).where(eq(schema.users.id, other));
  });
});
