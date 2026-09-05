import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { id } from "./_shared";
import { users } from "./auth";
import {
  NOTIFICATION_TYPES,
  type NotificationData,
} from "@/lib/notifications/types";
import type { NotificationType } from "@/lib/notifications/types";

/**
 * What people are told, and how they say they would rather not be.
 *
 * The shape of every row here follows from two positions #21 argues for:
 *
 * **Push is best-effort; the in-app centre is the source of truth.** A push
 * can fail for reasons entirely outside our control — permission never
 * granted, an expired endpoint, an iOS user who never installed the app and so
 * will *never* receive one. If the only record of "somebody replied to you"
 * were a push, those users lose the information. So every notification is a
 * ROW first and a push second.
 *
 * **No user-facing text is stored.** The row carries a type and structured
 * `data`; the sentence is composed at render time from the RECIPIENT's locale.
 * Storing "Sara replied to your comment" bakes in English for ever, breaks the
 * moment the reader is Arabic, and breaks again the moment the copy changes —
 * and it makes Arabic's zero/two/few/many plural forms impossible.
 */

export const notificationType = pgEnum("notification_type", NOTIFICATION_TYPES);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    // `text`, matching `users.id` — Better Auth owns that column's type.
    recipientId: text("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    type: notificationType("type").notNull(),

    /** The thing acted upon. Drives aggregation and the deep link. */
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),

    /**
     * The most recent actor. Null for a system event, and null again once that
     * account is deleted — `set null` rather than cascade, so removing a user
     * does not delete notifications other people received.
     */
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Distinct actors folded into this row, capped. Enough to render
     * "Sara, Omar and 3 others"; not a growing list nobody reads. */
    actorIds: jsonb("actor_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    actorCount: integer("actor_count").notNull().default(1),

    /** Structured and locale-free. See the note above. */
    data: jsonb("data")
      .$type<NotificationData>()
      .notNull()
      .default(sql`'{}'::jsonb`),

    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("notifications_inbox_idx").on(t.recipientId, t.createdAt.desc()),
    // Unread only, for the bell's badge — by far the most frequent query, and
    // one that would otherwise scan a person's whole history to count zero.
    index("notifications_unread_idx")
      .on(t.recipientId)
      .where(sql`read_at is null`),
    /**
     * **At most one UNREAD row per (recipient, type, subject) — for the types
     * that aggregate.**
     *
     * This partial unique index is what makes "5 people liked your comment"
     * one row instead of five, and it aggregates while UNREAD rather than on a
     * timer: somebody who has not looked at the bell should see one line;
     * somebody who read it and then got a new like deserves a fresh
     * notification. No scheduled compaction, no window to tune.
     *
     * The type list is restricted deliberately. Applied to every type it would
     * silently forbid a second unread REPLY to the same comment — two replies
     * are two things to read, and the database would reject the second with a
     * constraint error rather than a collapse. `tests/lib/notification-types.test.ts`
     * asserts this list still matches the catalogue's `aggregates` flags, so
     * adding an aggregating type without extending the index fails there
     * rather than in production.
     */
    uniqueIndex("notifications_aggregate_idx")
      .on(t.recipientId, t.type, t.subjectId)
      .where(
        sql`read_at is null and type in ('lesson.liked', 'comment.liked')`,
      ),
  ],
);

export const notificationPreferences = pgTable("notification_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),

  /** Per category. A missing key means the platform default, so a user with
   * no row is treated as having the defaults rather than as opted out. */
  categories: jsonb("categories")
    .$type<Partial<Record<NotificationType, boolean>>>()
    .notNull()
    .default(sql`'{}'::jsonb`),

  /** The master switch. In-app rows are still written — muting stops
   * delivery, never the record. */
  pushEnabled: boolean("push_enabled").notNull().default(true),

  /** A global mute with an end, so "leave me alone" cannot be forgotten. */
  mutedUntil: timestamp("muted_until", { withTimezone: true }),

  /** Local minutes from midnight; null disables quiet hours. */
  quietHoursStart: integer("quiet_hours_start"),
  quietHoursEnd: integer("quiet_hours_end"),
  /** Quiet hours are meaningless without it: evaluating them in the server's
   * zone wakes people at 3 a.m. everywhere but one place. */
  timezone: text("timezone").notNull().default("UTC"),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * The transactional outbox.
 *
 * Feature code inserts a row here **in the same transaction** as the domain
 * change. If the like rolls back, so does the event — no phantom notification
 * about a like that no longer exists, which is the property that matters most
 * and the one direct calls cannot offer.
 *
 * An in-process event emitter was the other candidate and is the wrong shape
 * for a serverless deployment: listeners registered in one instance do not
 * exist in another, work dispatched after the response is not guaranteed to
 * run, and events vanish on a cold start with no trace.
 */
export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: id(),
    type: notificationType("type").notNull(),
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    /** Everything the fan-out needs that it cannot re-derive: the recipient
     * for a personal event, the slug for the deep link. */
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),

    processedAt: timestamp("processed_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The drain's only query: unprocessed, oldest first.
    index("notification_outbox_pending_idx").on(t.processedAt, t.createdAt),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NotificationPreferenceRow =
  typeof notificationPreferences.$inferSelect;
export type OutboxEvent = typeof notificationOutbox.$inferSelect;
