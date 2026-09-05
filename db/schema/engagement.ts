import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { id } from "./_shared";
import { users } from "./auth";
import { lessons } from "./content";
import { SHARE_CHANNELS } from "@/lib/share/share-lesson";

/**
 * What readers do with a lesson: like it, save it, share it.
 *
 * Three tables rather than one `reactions` table with a `kind` column. They
 * look alike and are not: a like is public and counted, a save is private to
 * the person who made it and never displayed as a total, and a share is an
 * event that can happen repeatedly rather than a state that is on or off. One
 * table would need a nullable channel, a nullable target, and a rule nobody
 * can enforce about which columns apply to which kind.
 */

/**
 * **Idempotency lives in the primary key.**
 *
 * A double-tap, a retried request, a duplicated form submission — all of them
 * become one row, because the database refuses the second. The alternative,
 * checking for an existing row before inserting, is a race with a window in
 * it: two concurrent requests both read "no row" and both insert.
 */
export const lessonLikes = pgTable(
  "lesson_likes",
  {
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    // `text`, matching `users.id` — Better Auth owns that column's type.
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.lessonId, t.userId] }),
    // "Which lessons has this person liked" — for the profile, and cheap
    // enough that the alternative is a sequential scan per visit.
    index("lesson_likes_user_idx").on(t.userId, t.createdAt.desc()),
  ],
);

/**
 * Saves are PRIVATE. There is no "who saved this" list and the total is never
 * shown publicly — a reading list is a record of what somebody meant to study,
 * which is a different thing from an endorsement.
 */
export const lessonSaves = pgTable(
  "lesson_saves",
  {
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.lessonId, t.userId] }),
    index("lesson_saves_user_idx").on(t.userId, t.createdAt.desc()),
  ],
);

/** Kept in step with `lib/share/share-lesson.ts`, which defines what each
 * channel means and which of them may be counted. */
export const shareChannel = pgEnum("share_channel", SHARE_CHANNELS);

/**
 * One row per share, verified or not.
 *
 * An outbound click to an intent URL is stored with `verified = false`: it is
 * real intent data and worth having in the admin view, and it is NOT a share,
 * because `window.open` cannot observe whether the other origin's Post button
 * was ever pressed. Only `verified` rows move the public count.
 *
 * Rows rather than a counter because a share is an event: the same person can
 * share the same lesson twice, a week apart, and both happened.
 */
export const shareEvents = pgTable(
  "share_events",
  {
    id: id(),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    /** Null for an anonymous sharer, and null again once an account is
     * deleted — the share happened, and the count must not change because
     * the person left. */
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    channel: shareChannel("channel").notNull(),
    verified: boolean("verified").notNull(),
    /** `x`, `whatsapp`, … for an outbound link. Null otherwise. */
    target: text("target"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("share_events_lesson_idx").on(t.lessonId, t.createdAt.desc()),
    /**
     * Anti-inflation: at most one COUNTED share per (lesson, user, channel)
     * per hour. Somebody hammering the button inflates nothing.
     *
     * Partial, and only over signed-in verified rows: an anonymous sharer has
     * no id to deduplicate on, and NULLs in a unique index compare as
     * distinct, so including them would make the index do nothing while
     * looking like it did something.
     *
     * The bucket is computed `at time zone 'UTC'` because an index expression
     * must be IMMUTABLE: `date_trunc` over a `timestamptz` depends on the
     * session's TimeZone setting, so Postgres refuses it. Fixing the zone also
     * fixes what the hour MEANS — a dedupe window that moved with the reader's
     * time zone would be a different window per connection.
     */
    uniqueIndex("share_events_dedupe_idx")
      .on(
        t.lessonId,
        t.userId,
        t.channel,
        sql`date_trunc('hour', created_at at time zone 'UTC')`,
      )
      .where(sql`user_id is not null and verified`),
  ],
);

export type LessonLike = typeof lessonLikes.$inferSelect;
export type LessonSave = typeof lessonSaves.$inferSelect;
export type ShareEvent = typeof shareEvents.$inferSelect;
