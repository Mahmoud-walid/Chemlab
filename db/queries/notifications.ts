import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import type { SeedDatabase } from "@/db/seed/connect";
import {
  notificationOutbox,
  notificationPreferences,
  notifications,
} from "@/db/schema/notifications";
import { users } from "@/db/schema/auth";
import {
  DEFAULT_PREFERENCES,
  decidePush,
  shouldRecord,
  type Preferences,
} from "@/lib/notifications/rules";
import {
  aggregationPredicate,
  specFor,
  type NotificationType,
} from "@/lib/notifications/types";

/**
 * Turning outbox events into notifications.
 *
 * Takes a database handle rather than reaching for `getDb()`, and carries no
 * `server-only`: the fan-out runs from a scheduled script outside Next.js and
 * the integration tests drive it directly.
 */

/** Claimed per run. */
export const FANOUT_BATCH_SIZE = 100;

export interface PendingEvent {
  id: string;
  type: NotificationType;
  actorId: string | null;
  subjectType: string;
  subjectId: string;
  payload: { recipientId?: string | null; data?: Record<string, unknown> };
}

/**
 * Takes a batch of unprocessed events.
 *
 * `for update skip locked` for the same reason the push drain uses it: two
 * fan-outs running at once must skip each other's rows rather than turning one
 * event into two notifications.
 */
export async function claimEvents(
  db: SeedDatabase,
  limit: number = FANOUT_BATCH_SIZE,
): Promise<PendingEvent[]> {
  const result = await db.execute<PendingEvent & Record<string, unknown>>(sql`
    with claimed as (
      select o."id" from "notification_outbox" o
      where o."processed_at" is null
      order by o."created_at" asc
      limit ${limit}
      for update skip locked
    )
    select
      o."id", o."type", o."actor_id" as "actorId",
      o."subject_type" as "subjectType", o."subject_id" as "subjectId",
      o."payload"
    from "notification_outbox" o
    join claimed c on c."id" = o."id"
  `);

  return (result as unknown as { rows?: PendingEvent[] }).rows ?? [];
}

export async function markProcessed(
  db: SeedDatabase,
  eventId: string,
): Promise<void> {
  await db
    .update(notificationOutbox)
    .set({ processedAt: new Date(), attempts: sql`attempts + 1` })
    .where(eq(notificationOutbox.id, eventId));
}

export async function markEventFailed(
  db: SeedDatabase,
  eventId: string,
  reason: string,
): Promise<void> {
  await db
    .update(notificationOutbox)
    .set({ attempts: sql`attempts + 1`, lastError: reason.slice(0, 500) })
    .where(eq(notificationOutbox.id, eventId));
}

/** A user's preferences, or the platform defaults when they have no row. */
export async function preferencesFor(
  db: SeedDatabase,
  userId: string,
): Promise<Preferences> {
  const [row] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));

  if (!row) return DEFAULT_PREFERENCES;

  return {
    categories: row.categories,
    pushEnabled: row.pushEnabled,
    mutedUntil: row.mutedUntil,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    timezone: row.timezone,
  };
}

export interface RecordResult {
  /** False when the event was suppressed — a self-action, most often. */
  recorded: boolean;
  /** The row, when one was written or updated. */
  notificationId?: string;
  /** True when this folded into an existing unread row rather than making
   * a new one. */
  aggregated?: boolean;
}

/**
 * Writes one notification for one recipient.
 *
 * The aggregation is an upsert against the partial unique index on unread
 * rows: five people liking a comment produce ONE row whose `actor_count`
 * climbs. Done in SQL rather than read-then-write, because two likes arriving
 * together would otherwise both see "no row" and both insert — and the index
 * would reject the second, turning a race into an error instead of a count.
 */
export async function recordNotification(
  db: SeedDatabase,
  input: {
    recipientId: string;
    type: NotificationType;
    actorId: string | null;
    subjectType: string;
    subjectId: string;
    data?: Record<string, unknown>;
  },
): Promise<RecordResult> {
  if (!shouldRecord(input.type, input.actorId, input.recipientId)) {
    return { recorded: false };
  }

  const spec = specFor(input.type);
  const id = uuidv7();
  const actorIds = input.actorId ? [input.actorId] : [];

  if (!spec.aggregates) {
    await db.insert(notifications).values({
      id,
      recipientId: input.recipientId,
      type: input.type,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      actorId: input.actorId,
      actorIds,
      actorCount: 1,
      data: input.data ?? {},
    });
    return { recorded: true, notificationId: id, aggregated: false };
  }

  const result = await db.execute<{ id: string; actor_count: number }>(sql`
    insert into "notifications" (
      "id", "recipient_id", "type", "subject_type", "subject_id",
      "actor_id", "actor_ids", "actor_count", "data"
    )
    values (
      ${id}, ${input.recipientId}, ${input.type}, ${input.subjectType},
      ${input.subjectId}, ${input.actorId},
      ${JSON.stringify(actorIds)}::jsonb, 1,
      ${JSON.stringify(input.data ?? {})}::jsonb
    )
    -- The predicate must match the index's exactly or Postgres cannot infer
    -- the arbiter index, and a near-miss is an error rather than a slow path.
    -- Derived from the catalogue so the two cannot drift.
    on conflict ("recipient_id", "type", "subject_id")
      where ${sql.raw(aggregationPredicate())}
    do update set
      -- The newest actor becomes the one named first.
      "actor_id" = excluded."actor_id",
      -- Capped at five: enough to render "Sara, Omar and 3 others", and not a
      -- list that grows without bound in a column nobody reads to the end.
      "actor_ids" = (
        select jsonb_agg(value) from (
          select value from jsonb_array_elements(
            excluded."actor_ids" || "notifications"."actor_ids"
          ) limit 5
        ) as capped
      ),
      -- Counted only when this actor is new, so one person liking twice is
      -- still one person.
      "actor_count" = "notifications"."actor_count" + (
        case when "notifications"."actor_ids" @> excluded."actor_ids"
          then 0 else 1 end
      ),
      "data" = excluded."data",
      "updated_at" = now()
    returning "id", "actor_count"
  `);

  const rows = (result as unknown as { rows?: { id: string }[] }).rows ?? [];
  const returnedId = rows[0]?.id ?? id;

  return {
    recorded: true,
    notificationId: returnedId,
    aggregated: returnedId !== id,
  };
}

/** Everyone who could receive a broadcast: every user except the actor. */
export async function broadcastRecipients(
  db: SeedDatabase,
  exceptUserId: string | null,
): Promise<string[]> {
  const rows = await db.select({ id: users.id }).from(users);
  return rows.map((row) => row.id).filter((userId) => userId !== exceptUserId);
}

/** Whether a push may go out, and when. Re-exported so the worker reads as
 * one story rather than reaching into two modules. */
export async function pushDecisionFor(
  db: SeedDatabase,
  recipientId: string,
  type: NotificationType,
  now: Date,
) {
  return decidePush(type, await preferencesFor(db, recipientId), now);
}

/* --------------------------------------------------------------- reading -- */

export interface InboxPage {
  rows: {
    id: string;
    type: NotificationType;
    subjectType: string;
    subjectId: string;
    actorCount: number;
    actorName: string | null;
    data: Record<string, unknown>;
    readAt: Date | null;
    createdAt: Date;
  }[];
  /** Pass back as `before` for the next page. */
  nextCursor: string | null;
}

/**
 * One page of a person's inbox, newest first.
 *
 * Keyset on `(created_at, id)`, never OFFSET: notifications arrive at the head
 * constantly, so an offset page two is a different set of rows every time
 * anybody does anything.
 */
export async function listNotifications(
  db: SeedDatabase,
  recipientId: string,
  options: { limit?: number; before?: string } = {},
): Promise<InboxPage> {
  const limit = Math.min(options.limit ?? 20, 50);

  const cursor = options.before
    ? and(
        eq(notifications.recipientId, recipientId),
        lt(notifications.id, options.before),
      )
    : eq(notifications.recipientId, recipientId);

  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      subjectType: notifications.subjectType,
      subjectId: notifications.subjectId,
      actorCount: notifications.actorCount,
      actorName: users.name,
      data: notifications.data,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .leftJoin(users, eq(users.id, notifications.actorId))
    .where(cursor)
    // The ids are UUID v7, so ordering by id is ordering by time — and unlike
    // `created_at` it is unique, so a page boundary cannot fall between two
    // rows sharing a millisecond.
    .orderBy(desc(notifications.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  return {
    rows: page as InboxPage["rows"],
    nextCursor:
      rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export async function unreadCount(
  db: SeedDatabase,
  recipientId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientId, recipientId),
        isNull(notifications.readAt),
      ),
    );
  return row?.count ?? 0;
}

/** Marks one notification, or all of them, read. Scoped to the caller's own
 * rows — there is no user id parameter to get wrong. */
export async function markRead(
  db: SeedDatabase,
  recipientId: string,
  notificationIds: string[] | "all",
): Promise<number> {
  const scope =
    notificationIds === "all"
      ? eq(notifications.recipientId, recipientId)
      : and(
          eq(notifications.recipientId, recipientId),
          inArray(notifications.id, notificationIds),
        );

  const result = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(scope, isNull(notifications.readAt)));

  return result.rowCount ?? 0;
}

/** Old, read notifications. The table is unbounded otherwise. */
export async function pruneRead(
  db: SeedDatabase,
  before: Date,
): Promise<number> {
  const result = await db
    .delete(notifications)
    .where(
      and(
        or(isNull(notifications.readAt), lt(notifications.readAt, before)),
        lt(notifications.createdAt, before),
      ),
    );
  return result.rowCount ?? 0;
}
