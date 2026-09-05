import {
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { id } from "./_shared";
import { users } from "./auth";
import { ACTIVITY_OBJECT_TYPES, ACTIVITY_VERBS } from "@/lib/activity/verbs";

/**
 * What people did, as an append-only stream.
 *
 * **Not the same table as `audit_log`, deliberately.** They look alike and
 * answer different questions:
 *
 * - `audit_log` is a security record. A trigger refuses UPDATE and DELETE, it
 *   is never pruned, and it exists so that how somebody came to hold a
 *   permission can be reconstructed afterwards — including by someone
 *   investigating the person who granted it.
 * - `activity_events` is analytics. It will out-grow every other table by an
 *   order of magnitude, it carries personal data (IP, user agent), and it is
 *   pruned on a retention schedule.
 *
 * One table cannot be both: either the retention job deletes the audit trail,
 * or the analytics table can never be pruned. The `admin.*` verbs are written
 * to both, from one helper, which is the price of keeping them apart.
 */

/** Enum rather than text: see lib/activity/verbs.ts for why it is closed. */
export const activityVerb = pgEnum("activity_verb", ACTIVITY_VERBS);

export const activityObjectType = pgEnum(
  "activity_object_type",
  ACTIVITY_OBJECT_TYPES,
);

export const activityEvents = pgTable(
  "activity_events",
  {
    id: id(),

    /**
     * Null for an anonymous actor, and null again once the person is deleted —
     * `set null` rather than `cascade`, so deleting an account anonymises the
     * stream instead of rewriting history. Aggregate counts stay correct.
     */
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),

    verb: activityVerb("verb").notNull(),
    objectType: activityObjectType("object_type"),
    /**
     * Text, not uuid: an element is keyed by atomic number and a page by its
     * route. A foreign key is impossible across that many parents anyway, and
     * the row must outlive whatever it points at.
     */
    objectId: text("object_id"),

    /** Verb-specific detail. Never queried by key unless an index says so. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),

    /** Which sitting this happened in, for reconstructing a session. */
    sessionId: text("session_id"),

    /**
     * Personal data, both of them, and treated as such: readable only with
     * `activity:read_pii`, nulled BY THE QUERY for everyone else, and purged
     * ahead of the events themselves. The IP is stored truncated — see
     * lib/activity/record.ts.
     */
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The four access patterns this table has, and no more. A GIN index on
    // `metadata` is deliberately absent: it is a real cost on every insert and
    // no query needs it yet.
    index("activity_events_created_idx").on(t.createdAt.desc()),
    index("activity_events_actor_idx").on(t.actorId, t.createdAt.desc()),
    index("activity_events_verb_idx").on(t.verb, t.createdAt.desc()),
    index("activity_events_object_idx").on(
      t.objectType,
      t.objectId,
      t.createdAt.desc(),
    ),
  ],
);

export type ActivityEvent = typeof activityEvents.$inferSelect;
export type NewActivityEvent = typeof activityEvents.$inferInsert;

/**
 * Pre-aggregated activity, so dashboards never scan the raw event table.
 *
 * `activity_events` will out-grow every other table by an order of magnitude,
 * and a dashboard that counts over it on every load gets slower every day it
 * is used. This is written once per closed day and read for every chart; the
 * current day is the only thing queried live, and it is bounded by definition.
 *
 * A rollup TABLE rather than a materialised view, deliberately. `REFRESH
 * MATERIALIZED VIEW CONCURRENTLY` re-computes everything on a schedule we do
 * not control and holds a chunk of the compute budget while it does; a table
 * is incrementally updatable with `ON CONFLICT DO UPDATE`, cheap to backfill,
 * and re-runnable for one day without touching the rest.
 *
 * `objectId` is part of the key so "most-viewed lessons" is answerable from
 * here too. It is NOT null-able for that reason: Postgres treats NULLs in a
 * primary key as distinct, which would let the same day/verb pair be inserted
 * repeatedly and quietly break idempotency. The empty string is the "no
 * object" value instead.
 */
export const activityDailyRollup = pgTable(
  "activity_daily_rollup",
  {
    day: date("day").notNull(),
    verb: activityVerb("verb").notNull(),
    objectType: text("object_type").notNull().default(""),
    objectId: text("object_id").notNull().default(""),
    eventCount: integer("event_count").notNull(),
    /** Distinct signed-in actors. Anonymous events count in neither. */
    uniqueActors: integer("unique_actors").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.day, t.verb, t.objectType, t.objectId] }),
    index("activity_rollup_day_idx").on(t.day),
  ],
);
