import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { findCounterDrift, repairCounters } from "@/db/queries/counters";

/**
 * Likes, saves, shares and the counters behind them.
 *
 * Everything here needs a real database, because everything here is enforced
 * BY the database: idempotency by a composite primary key, the counters by
 * triggers, the share dedupe by a partial unique index. A mocked test would
 * assert that the application intended the right thing, which is not the
 * property in question.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

const USER = `engagement-${uuidv7()}`;
const OTHER = `engagement-other-${uuidv7()}`;
let lessonId: string;
const SLUG = `engagement-suite-${Date.now()}`;

async function counts() {
  const [row] = await db
    .select({
      likeCount: schema.lessons.likeCount,
      saveCount: schema.lessons.saveCount,
      shareCount: schema.lessons.shareCount,
    })
    .from(schema.lessons)
    .where(eq(schema.lessons.id, lessonId));
  return row!;
}

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  for (const id of [USER, OTHER]) {
    await db.insert(schema.users).values({
      id,
      name: "Engagement suite",
      email: `${id}@engagement.invalid`,
      emailVerified: true,
    });
  }

  lessonId = uuidv7();
  await db.insert(schema.lessons).values({
    id: lessonId,
    slug: SLUG,
    title: "Engagement suite lesson",
    description: "Created by tests/integration/lessons-engagement.test.ts.",
    difficulty: "easy",
    category: "Testing",
    status: "published",
  });
});

afterEach(async () => {
  await db
    .delete(schema.lessonLikes)
    .where(eq(schema.lessonLikes.lessonId, lessonId));
  await db
    .delete(schema.lessonSaves)
    .where(eq(schema.lessonSaves.lessonId, lessonId));
  await db
    .delete(schema.shareEvents)
    .where(eq(schema.shareEvents.lessonId, lessonId));
});

afterAll(async () => {
  await db.delete(schema.lessons).where(eq(schema.lessons.id, lessonId));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
  await db.delete(schema.users).where(eq(schema.users.id, OTHER));
  await close?.();
});

describe("likes", () => {
  it("counts one like per person", async () => {
    await db.insert(schema.lessonLikes).values({ lessonId, userId: USER });
    await db.insert(schema.lessonLikes).values({ lessonId, userId: OTHER });
    expect((await counts()).likeCount).toBe(2);
  });

  it("stays at one when the same person likes twice", async () => {
    // #20's acceptance criterion. The idempotency is the primary key's, not a
    // check-then-insert — which has a window in which two concurrent requests
    // both see nothing and both write.
    await db.insert(schema.lessonLikes).values({ lessonId, userId: USER });
    await db
      .insert(schema.lessonLikes)
      .values({ lessonId, userId: USER })
      .onConflictDoNothing();

    expect((await counts()).likeCount).toBe(1);
  });

  it("decrements when a like is removed", async () => {
    await db.insert(schema.lessonLikes).values({ lessonId, userId: USER });
    await db
      .delete(schema.lessonLikes)
      .where(eq(schema.lessonLikes.userId, USER));
    expect((await counts()).likeCount).toBe(0);
  });

  it("follows a cascade delete when an account is removed", async () => {
    // The reason the counter is a trigger. `on delete cascade` removes the
    // like without running a single line of application code, so a service
    // layer maintaining this number would never see it happen.
    const leaver = `engagement-leaver-${uuidv7()}`;
    await db.insert(schema.users).values({
      id: leaver,
      name: "Leaver",
      email: `${leaver}@engagement.invalid`,
      emailVerified: true,
    });
    await db.insert(schema.lessonLikes).values({ lessonId, userId: leaver });
    expect((await counts()).likeCount).toBe(1);

    await db.delete(schema.users).where(eq(schema.users.id, leaver));
    expect((await counts()).likeCount).toBe(0);
  });
});

describe("saves", () => {
  it("counts and un-counts", async () => {
    await db.insert(schema.lessonSaves).values({ lessonId, userId: USER });
    expect((await counts()).saveCount).toBe(1);

    await db
      .delete(schema.lessonSaves)
      .where(eq(schema.lessonSaves.userId, USER));
    expect((await counts()).saveCount).toBe(0);
  });

  it("is idempotent, like a like", async () => {
    await db.insert(schema.lessonSaves).values({ lessonId, userId: USER });
    await db
      .insert(schema.lessonSaves)
      .values({ lessonId, userId: USER })
      .onConflictDoNothing();
    expect((await counts()).saveCount).toBe(1);
  });
});

describe("shares", () => {
  it("counts a verified share", async () => {
    await db.insert(schema.shareEvents).values({
      id: uuidv7(),
      lessonId,
      userId: USER,
      channel: "web_share",
      verified: true,
    });
    expect((await counts()).shareCount).toBe(1);
  });

  it("does NOT count an outbound link", async () => {
    // The rule the feature exists for: `window.open` to an intent URL says the
    // user left, not that they pressed Post. The row is kept as intent data.
    await db.insert(schema.shareEvents).values({
      id: uuidv7(),
      lessonId,
      userId: USER,
      channel: "outbound_link",
      verified: false,
      target: "x",
    });

    expect((await counts()).shareCount).toBe(0);
    const rows = await db
      .select({ id: schema.shareEvents.id })
      .from(schema.shareEvents)
      .where(eq(schema.shareEvents.lessonId, lessonId));
    expect(rows).toHaveLength(1);
  });

  it("counts a repeated verified share once per hour", async () => {
    const insert = () =>
      db
        .insert(schema.shareEvents)
        .values({
          id: uuidv7(),
          lessonId,
          userId: USER,
          channel: "web_share",
          verified: true,
        })
        .onConflictDoNothing();

    await insert();
    await insert();
    await insert();

    expect((await counts()).shareCount).toBe(1);
  });

  it("counts the same person again in a different hour", async () => {
    await db.insert(schema.shareEvents).values({
      id: uuidv7(),
      lessonId,
      userId: USER,
      channel: "web_share",
      verified: true,
      createdAt: new Date(Date.UTC(2026, 0, 1, 10, 30)),
    });
    await db.insert(schema.shareEvents).values({
      id: uuidv7(),
      lessonId,
      userId: USER,
      channel: "web_share",
      verified: true,
      createdAt: new Date(Date.UTC(2026, 0, 1, 11, 30)),
    });

    expect((await counts()).shareCount).toBe(2);
  });

  it("counts two people in the same hour separately", async () => {
    for (const userId of [USER, OTHER]) {
      await db
        .insert(schema.shareEvents)
        .values({
          id: uuidv7(),
          lessonId,
          userId,
          channel: "web_share",
          verified: true,
        })
        .onConflictDoNothing();
    }
    expect((await counts()).shareCount).toBe(2);
  });

  it("keeps an anonymous share, unverified and uncounted", async () => {
    // No id to deduplicate on, so it falls outside the dedupe index — which is
    // exactly why it must not be counted.
    await db.insert(schema.shareEvents).values({
      id: uuidv7(),
      lessonId,
      userId: null,
      channel: "clipboard",
      verified: false,
    });
    expect((await counts()).shareCount).toBe(0);
  });
});

describe("reconciliation", () => {
  it("reports no drift on a healthy database", async () => {
    await db.insert(schema.lessonLikes).values({ lessonId, userId: USER });
    expect(await findCounterDrift(db)).toEqual([]);
  });

  it("catches a counter that something wrote around", async () => {
    // The failure this exists to catch: a migration that dropped a trigger, a
    // bulk load with triggers disabled, a hand-edited row. The number looks
    // fine and is wrong.
    await db.insert(schema.lessonLikes).values({ lessonId, userId: USER });
    await db.execute(
      sql`update lessons set like_count = 99 where id = ${lessonId}`,
    );

    const drift = await findCounterDrift(db);
    expect(drift).toContainEqual({
      slug: SLUG,
      column: "like_count",
      stored: 99,
      actual: 1,
    });

    await repairCounters(db);
    expect(await findCounterDrift(db)).toEqual([]);
  });
});
