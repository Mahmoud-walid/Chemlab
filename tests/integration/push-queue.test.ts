import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import {
  claimDue,
  enqueueForUsers,
  markExpired,
  markRetry,
  markSent,
  pruneFinished,
} from "@/lib/push/queue";
import { drain } from "@/lib/push/send";
import { parsePayload } from "@/lib/push/payload";

/**
 * The push queue, against real Postgres.
 *
 * Everything worth proving here is a database behaviour: that a fan-out writes
 * one row per DEVICE, that two drains cannot claim the same row, and — the one
 * that keeps the table honest — that a 410 deletes the subscription instead of
 * leaving a ghost to be retried for ever.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

const USER = `push-${uuidv7()}`;
const OTHER = `push-other-${uuidv7()}`;
const PAYLOAD = parsePayload({ title: "A reply", body: "Sara replied." });

function endpoint(name: string): string {
  return `https://push.test/${name}-${uuidv7()}`;
}

async function subscribe(userId: string): Promise<string> {
  const id = uuidv7();
  await db.insert(schema.pushSubscriptions).values({
    id,
    userId,
    endpoint: endpoint("device"),
    p256dh: "B".repeat(87),
    auth: "C".repeat(22),
  });
  return id;
}

async function deliveries() {
  return db
    .select({
      id: schema.pushDeliveries.id,
      status: schema.pushDeliveries.status,
      attempts: schema.pushDeliveries.attempts,
    })
    .from(schema.pushDeliveries);
}

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  for (const id of [USER, OTHER]) {
    await db.insert(schema.users).values({
      id,
      name: "Push suite",
      email: `${id}@push.invalid`,
      emailVerified: true,
    });
  }
});

afterEach(async () => {
  await db.delete(schema.pushDeliveries);
  await db
    .delete(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.userId, USER));
  await db
    .delete(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.userId, OTHER));
});

afterAll(async () => {
  await db.delete(schema.users).where(eq(schema.users.id, USER));
  await db.delete(schema.users).where(eq(schema.users.id, OTHER));
  await close?.();
});

describe("enqueueForUsers", () => {
  it("writes one delivery per device, not per user", async () => {
    await subscribe(USER);
    await subscribe(USER);

    const result = await enqueueForUsers(db, [USER], PAYLOAD);

    expect(result.queued).toBe(2);
    expect(await deliveries()).toHaveLength(2);
  });

  it("is a no-op for a user with no subscriptions", async () => {
    // "Notify the lesson author" must not fail because the author has never
    // enabled push — which is most authors, most of the time.
    const result = await enqueueForUsers(db, [USER], PAYLOAD);

    expect(result).toEqual({ queued: 0, skipped: 1 });
    expect(await deliveries()).toHaveLength(0);
  });

  it("refuses a payload no push service would accept", async () => {
    await subscribe(USER);
    const fat = parsePayload({
      title: "Big",
      body: "Big",
      data: { blob: "x".repeat(5000) },
    });

    // Caught here rather than as a 413 long after the sender returned.
    await expect(enqueueForUsers(db, [USER], fat)).rejects.toThrow(/size/i);
    expect(await deliveries()).toHaveLength(0);
  });

  it("reaches every named user's devices", async () => {
    await subscribe(USER);
    await subscribe(OTHER);

    const result = await enqueueForUsers(db, [USER, OTHER], PAYLOAD);
    expect(result.queued).toBe(2);
  });
});

describe("claimDue", () => {
  it("takes only rows that are due", async () => {
    await subscribe(USER);
    const soon = new Date(Date.now() + 60 * 60 * 1000);
    await enqueueForUsers(db, [USER], PAYLOAD, soon);

    expect(await claimDue(db, new Date())).toHaveLength(0);
    expect(await claimDue(db, new Date(soon.getTime() + 1000))).toHaveLength(1);
  });

  it("returns the keys the sender needs, joined from the subscription", async () => {
    await subscribe(USER);
    await enqueueForUsers(db, [USER], PAYLOAD);

    const [claimed] = await claimDue(db);
    expect(claimed!.endpoint).toContain("https://push.test/");
    expect(claimed!.p256dh).toHaveLength(87);
    expect(claimed!.payload.title).toBe("A reply");
  });

  it("leaves the row pending, so nothing is marked sent before it is", async () => {
    await subscribe(USER);
    await enqueueForUsers(db, [USER], PAYLOAD);
    await claimDue(db);

    expect((await deliveries())[0]!.status).toBe("pending");
  });
});

describe("outcomes", () => {
  it("records a send and refreshes the device", async () => {
    const subscriptionId = await subscribe(USER);
    await enqueueForUsers(db, [USER], PAYLOAD);
    const [claimed] = await claimDue(db);

    await markSent(db, claimed!.id, subscriptionId);

    expect((await deliveries())[0]!.status).toBe("sent");
    const [subscription] = await db
      .select({ lastUsedAt: schema.pushSubscriptions.lastUsedAt })
      .from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.id, subscriptionId));
    expect(subscription!.lastUsedAt).not.toBeNull();
  });

  it("DELETES the subscription when the service says it is gone", async () => {
    // The rule that keeps a table of live users from becoming a table of
    // ghosts. #17's acceptance criterion.
    const subscriptionId = await subscribe(USER);
    await enqueueForUsers(db, [USER], PAYLOAD);

    await markExpired(db, subscriptionId);

    const rows = await db
      .select({ id: schema.pushSubscriptions.id })
      .from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.id, subscriptionId));
    expect(rows).toHaveLength(0);
    // And its deliveries go with it, by cascade.
    expect(await deliveries()).toHaveLength(0);
  });

  it("pushes a retry into the future and counts it against the device", async () => {
    const subscriptionId = await subscribe(USER);
    await enqueueForUsers(db, [USER], PAYLOAD);
    const [claimed] = await claimDue(db);

    await markRetry(db, claimed!.id, subscriptionId, 300, "503");

    // Still pending, but no longer due — which is what stops a drain from
    // spinning on the same failing row.
    expect(await claimDue(db, new Date())).toHaveLength(0);
    const [subscription] = await db
      .select({ failureCount: schema.pushSubscriptions.failureCount })
      .from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.id, subscriptionId));
    expect(subscription!.failureCount).toBe(1);
  });
});

describe("drain", () => {
  it("sends what is due and marks it", async () => {
    await subscribe(USER);
    await enqueueForUsers(db, [USER], PAYLOAD);

    const result = await drain(db, { send: async () => undefined as never });

    expect(result).toMatchObject({ attempted: 1, sent: 1 });
    expect((await deliveries())[0]!.status).toBe("sent");
  });

  it("removes a device the push service reports as gone", async () => {
    await subscribe(USER);
    await enqueueForUsers(db, [USER], PAYLOAD);

    const gone = async () => {
      throw Object.assign(new Error("Gone"), { statusCode: 410 });
    };
    const result = await drain(db, { send: gone as never });

    expect(result).toMatchObject({ expired: 1 });
    const rows = await db
      .select({ id: schema.pushSubscriptions.id })
      .from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.userId, USER));
    expect(rows).toHaveLength(0);
  });

  it("does not let one dead endpoint stop the rest of the batch", async () => {
    // An unhandled throw inside the loop would abandon every delivery after
    // the first failure — the failure mode that makes a queue useless.
    await subscribe(USER);
    await subscribe(OTHER);
    await enqueueForUsers(db, [USER, OTHER], PAYLOAD);

    let call = 0;
    const flaky = async () => {
      call += 1;
      if (call === 1)
        throw Object.assign(new Error("Gone"), { statusCode: 410 });
      return undefined as never;
    };

    const result = await drain(db, { send: flaky as never });
    expect(result.attempted).toBe(2);
    expect(result.sent).toBe(1);
    expect(result.expired).toBe(1);
  });

  it("retries a 500 rather than giving up on it", async () => {
    await subscribe(USER);
    await enqueueForUsers(db, [USER], PAYLOAD);

    const down = async () => {
      throw Object.assign(new Error("Service Unavailable"), {
        statusCode: 503,
      });
    };
    const result = await drain(db, { send: down as never });

    expect(result).toMatchObject({ retried: 1 });
    expect((await deliveries())[0]!.status).toBe("pending");
  });

  it("gives up on a payload the service will never accept", async () => {
    await subscribe(USER);
    await enqueueForUsers(db, [USER], PAYLOAD);

    const tooBig = async () => {
      throw Object.assign(new Error("Payload Too Large"), { statusCode: 413 });
    };
    const result = await drain(db, { send: tooBig as never });

    expect(result).toMatchObject({ failed: 1 });
    expect((await deliveries())[0]!.status).toBe("failed");
  });

  it("does nothing, successfully, when the queue is empty", async () => {
    const result = await drain(db, { send: async () => undefined as never });
    expect(result.attempted).toBe(0);
  });
});

describe("pruneFinished", () => {
  it("removes settled rows but leaves pending ones", async () => {
    const subscriptionId = await subscribe(USER);
    await enqueueForUsers(db, [USER], PAYLOAD);
    const [claimed] = await claimDue(db);
    await markSent(db, claimed!.id, subscriptionId);
    await enqueueForUsers(db, [USER], PAYLOAD);

    const removed = await pruneFinished(db, new Date(Date.now() + 1000));

    expect(removed).toBe(1);
    const left = await deliveries();
    expect(left).toHaveLength(1);
    expect(left[0]!.status).toBe("pending");
  });
});
