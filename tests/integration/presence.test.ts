import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { heartbeat, presenceFor } from "@/db/queries/presence";
import {
  AWAY_WINDOW_SECONDS,
  ONLINE_WINDOW_SECONDS,
  WRITE_FLOOR_SECONDS,
} from "@/lib/presence/constants";
import { presenceViewSql } from "@/scripts/presence-view";

/**
 * Presence, against real Postgres.
 *
 * Two things can only be settled here: that the visibility rule is enforced in
 * the VIEW rather than in the client, and that the conditional write really
 * does match zero rows when a beat arrives early — which is the whole reason
 * this feature does not flood the database.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

const SEEN = `presence-seen-${uuidv7()}`;
const HIDDEN = `presence-hidden-${uuidv7()}`;
const NEVER = `presence-never-${uuidv7()}`;
const USERS = [SEEN, HIDDEN, NEVER];

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  for (const id of USERS) {
    await db
      .insert(schema.users)
      .values({
        id,
        name: `P ${id.slice(-4)}`,
        email: `${id}@presence.invalid`,
      })
      .onConflictDoNothing();
  }

  await db
    .update(schema.users)
    .set({ presenceVisibility: "nobody" })
    .where(eq(schema.users.id, HIDDEN));
});

afterAll(async () => {
  for (const id of USERS) {
    await db.delete(schema.users).where(eq(schema.users.id, id));
  }
  await close?.();
});

beforeEach(async () => {
  await db
    .delete(schema.userPresence)
    .where(eq(schema.userPresence.userId, SEEN));
});

describe("the view", () => {
  it("matches the constants it was generated from", () => {
    // The client's flicker tolerance and the server's window must not drift
    // apart. Two hand-written copies of "150 seconds" is one of them going
    // stale, silently, in a direction nobody notices.
    const migration = readFileSync(
      path.join(process.cwd(), "db/migrations/0021_presence.sql"),
      "utf8",
    );

    expect(migration).toContain(`interval '${ONLINE_WINDOW_SECONDS} seconds'`);
    expect(migration).toContain(`interval '${AWAY_WINDOW_SECONDS} seconds'`);
    // And the generator still produces exactly what shipped.
    expect(migration).toContain(presenceViewSql().split("\n")[1]!);
  });

  it("derives the three states from one timestamp", async () => {
    await heartbeat(db, SEEN);
    expect((await presenceFor(db, [SEEN]))[0]!.state).toBe("online");

    const backdate = async (seconds: number) => {
      await db.execute(sql`
        update user_presence
        set last_seen_at = now() - interval '${sql.raw(String(seconds))} seconds'
        where user_id = ${SEEN}
      `);
    };

    await backdate(ONLINE_WINDOW_SECONDS + 10);
    expect((await presenceFor(db, [SEEN]))[0]!.state).toBe("away");

    await backdate(AWAY_WINDOW_SECONDS + 10);
    expect((await presenceFor(db, [SEEN]))[0]!.state).toBe("offline");
  });

  it("returns nothing for somebody who has never been seen", async () => {
    // No row, so no entry — the caller renders nothing rather than a false
    // "offline".
    expect(await presenceFor(db, [NEVER])).toEqual([]);
  });
});

describe("hidden presence", () => {
  it("is offline with a null timestamp in the SQL, not in the client", async () => {
    // Asserted on the query's own output: filtering in the route would put
    // the real timestamp in the response of anybody who looked at the network
    // tab, and "hidden" would mean "hidden unless you open devtools".
    await heartbeat(db, HIDDEN);

    const [row] = await presenceFor(db, [HIDDEN]);
    expect(row!.state).toBe("offline");
    expect(row!.lastSeenAt).toBeNull();
  });

  it("cannot be read by asking for that user directly", async () => {
    await heartbeat(db, HIDDEN);
    const rows = await presenceFor(db, [HIDDEN, SEEN]);
    const hidden = rows.find((row) => row.userId === HIDDEN);
    expect(hidden?.lastSeenAt).toBeNull();
  });
});

describe("the conditional write", () => {
  it("writes the first beat", async () => {
    expect((await heartbeat(db, SEEN)).written).toBe(true);
  });

  it("matches zero rows for a beat inside the floor", async () => {
    // The whole reason this feature does not flood the database: duplicate
    // beats, retries and a second tab that lost the election all cost nothing.
    await heartbeat(db, SEEN);
    expect((await heartbeat(db, SEEN)).written).toBe(false);
    expect((await heartbeat(db, SEEN)).written).toBe(false);
  });

  it("writes again once the floor has passed", async () => {
    await heartbeat(db, SEEN);
    await db.execute(sql`
      update user_presence
      set last_seen_at = now() - interval '${sql.raw(String(WRITE_FLOOR_SECONDS + 5))} seconds'
      where user_id = ${SEEN}
    `);

    expect((await heartbeat(db, SEEN)).written).toBe(true);
  });

  it("caps a burst at one write", async () => {
    // Ten beats arriving together — five tabs, a retry, a double submit.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => heartbeat(db, SEEN)),
    );
    expect(results.filter((result) => result.written)).toHaveLength(1);
  });
});

describe("the coarse path", () => {
  it("is withheld unless the caller is entitled to it", async () => {
    // Withheld in the query rather than in the route, so a second caller
    // cannot forget. "Sara is reading Atomic Structure" is a much larger step
    // than a green dot.
    await heartbeat(db, SEEN, "/lessons/[slug]");

    expect((await presenceFor(db, [SEEN]))[0]!.lastPath).toBeNull();
    expect(
      (await presenceFor(db, [SEEN], { includePath: true }))[0]!.lastPath,
    ).toBe("/lessons/[slug]");
  });
});
