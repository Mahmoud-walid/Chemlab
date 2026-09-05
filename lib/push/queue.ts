import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import type { AnyDatabase } from "@/db/any-database";
import { pushDeliveries, pushSubscriptions } from "@/db/schema/push";
import {
  isWithinSizeLimit,
  type NotificationPayload,
} from "@/lib/push/payload";

/**
 * Enqueueing and draining pushes.
 *
 * Takes a database handle rather than reaching for `getDb()`, and carries no
 * `server-only`: the drain runs from a scheduled script outside Next.js, and
 * the integration tests drive it against real rows. A queue nobody can run in
 * a test is a queue nobody has seen work.
 *
 * The queue exists because a request that triggers five hundred notifications
 * must not block on five hundred HTTPS calls. It writes rows and returns; a
 * serverless function killed part-way through leaves the rows, not a half-sent
 * fan-out nobody can reconstruct.
 */

/** Claimed per drain. Small enough to finish inside a short invocation, large
 * enough that a backlog clears in minutes rather than hours. */
export const DRAIN_BATCH_SIZE = 100;

export interface EnqueueResult {
  queued: number;
  /** Users with no subscription at all. Not an error — most users have none. */
  skipped: number;
}

/**
 * Queues one payload for every device belonging to these users.
 *
 * Sending to a user with no subscriptions is a no-op, deliberately: "notify
 * the lesson author" must not fail because the author has never enabled push.
 */
export async function enqueueForUsers(
  db: AnyDatabase,
  userIds: readonly string[],
  payload: NotificationPayload,
  scheduledFor: Date = new Date(),
): Promise<EnqueueResult> {
  if (userIds.length === 0) return { queued: 0, skipped: 0 };

  // Checked before the write, not at send time: a 413 arrives long after the
  // code that built the payload has returned, and by then there is nothing to
  // fix but a row in a queue.
  if (!isWithinSizeLimit(payload)) {
    throw new Error(
      "Push payload exceeds the size a push service will accept. " +
        "Send an identifier and let the app fetch the detail.",
    );
  }

  const subscriptions = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, [...userIds]));

  if (subscriptions.length === 0) {
    return { queued: 0, skipped: userIds.length };
  }

  await db.insert(pushDeliveries).values(
    subscriptions.map((subscription) => ({
      id: uuidv7(),
      subscriptionId: subscription.id,
      payload,
      scheduledFor,
    })),
  );

  return { queued: subscriptions.length, skipped: 0 };
}

export interface ClaimedDelivery {
  id: string;
  subscriptionId: string;
  attempts: number;
  payload: NotificationPayload;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Takes a batch of due deliveries.
 *
 * `for update skip locked` is what makes two drains running at once safe: the
 * second skips the rows the first is holding rather than blocking on them or,
 * worse, sending them a second time. A cron that overlaps its previous run is
 * a normal condition, not an exceptional one.
 *
 * Claimed rows stay `pending`; the caller updates each one once its outcome
 * is known. Marking a row sent before sending it would make the queue's own
 * record of what happened untrue, which is the one thing it exists to be.
 */
export async function claimDue(
  db: AnyDatabase,
  now: Date = new Date(),
  limit: number = DRAIN_BATCH_SIZE,
): Promise<ClaimedDelivery[]> {
  const result = await db.execute<
    ClaimedDelivery & Record<string, unknown>
  >(sql`
    with claimed as (
      select d."id"
      from "push_deliveries" d
      where d."status" = 'pending' and d."scheduled_for" <= ${now}
      order by d."scheduled_for" asc
      limit ${limit}
      for update skip locked
    )
    select
      d."id",
      d."subscription_id" as "subscriptionId",
      d."attempts",
      d."payload",
      s."endpoint",
      s."p256dh",
      s."auth"
    from "push_deliveries" d
    join claimed c on c."id" = d."id"
    join "push_subscriptions" s on s."id" = d."subscription_id"
  `);

  return (result as unknown as { rows?: ClaimedDelivery[] }).rows ?? [];
}

/** Delivered. */
export async function markSent(
  db: AnyDatabase,
  deliveryId: string,
  subscriptionId: string,
): Promise<void> {
  await db
    .update(pushDeliveries)
    .set({ status: "sent", sentAt: new Date(), attempts: sql`attempts + 1` })
    .where(eq(pushDeliveries.id, deliveryId));

  // Also the answer to "is this device still real" — a subscription that has
  // received something recently is one worth keeping.
  await db
    .update(pushSubscriptions)
    .set({ lastUsedAt: new Date(), failureCount: 0 })
    .where(eq(pushSubscriptions.id, subscriptionId));
}

/**
 * The subscription is gone.
 *
 * The row is DELETED rather than flagged. A 410 is the push service stating
 * that this address is permanently dead; keeping it means every future fan-out
 * pays for a request that cannot succeed, and the count of "users we can
 * reach" slowly becomes a lie. The deliveries cascade with it.
 */
export async function markExpired(
  db: AnyDatabase,
  subscriptionId: string,
): Promise<void> {
  await db
    .update(pushDeliveries)
    .set({ status: "expired", attempts: sql`attempts + 1` })
    .where(
      and(
        eq(pushDeliveries.subscriptionId, subscriptionId),
        eq(pushDeliveries.status, "pending"),
      ),
    );

  await db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.id, subscriptionId));
}

/** Retry later, with the caller's backoff. */
export async function markRetry(
  db: AnyDatabase,
  deliveryId: string,
  subscriptionId: string,
  afterSeconds: number,
  reason: string,
): Promise<void> {
  await db
    .update(pushDeliveries)
    .set({
      attempts: sql`attempts + 1`,
      lastError: reason.slice(0, 500),
      scheduledFor: new Date(Date.now() + afterSeconds * 1000),
    })
    .where(eq(pushDeliveries.id, deliveryId));

  await db
    .update(pushSubscriptions)
    .set({ failureCount: sql`failure_count + 1` })
    .where(eq(pushSubscriptions.id, subscriptionId));
}

/** Abandoned: our fault, or out of attempts. */
export async function markFailed(
  db: AnyDatabase,
  deliveryId: string,
  reason: string,
): Promise<void> {
  await db
    .update(pushDeliveries)
    .set({
      status: "failed",
      attempts: sql`attempts + 1`,
      lastError: reason.slice(0, 500),
    })
    .where(eq(pushDeliveries.id, deliveryId));
}

/** Subscriptions that have failed too often to be worth keeping. */
export async function pruneFailedSubscriptions(
  db: AnyDatabase,
  threshold: number,
): Promise<number> {
  const result = await db
    .delete(pushSubscriptions)
    .where(sql`${pushSubscriptions.failureCount} >= ${threshold}`);

  return result.rowCount ?? 0;
}

/** Deliveries that have exhausted their attempts, closed out in one statement
 * rather than one at a time. */
export async function failExhausted(
  db: AnyDatabase,
  maxAttempts: number,
): Promise<number> {
  const result = await db
    .update(pushDeliveries)
    .set({ status: "failed", lastError: "attempts exhausted" })
    .where(
      and(
        eq(pushDeliveries.status, "pending"),
        sql`${pushDeliveries.attempts} >= ${maxAttempts}`,
      ),
    );

  return result.rowCount ?? 0;
}

/** Old, finished rows. Kept briefly for "I never got it" reports, then
 * removed — the queue is a queue, not an archive. */
export async function pruneFinished(
  db: AnyDatabase,
  before: Date,
): Promise<number> {
  const result = await db
    .delete(pushDeliveries)
    .where(
      and(
        inArray(pushDeliveries.status, ["sent", "failed", "expired"]),
        lte(pushDeliveries.createdAt, before),
      ),
    );

  return result.rowCount ?? 0;
}
