import { sql } from "drizzle-orm";
import {
  check,
  type AnyPgColumn,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { id } from "./_shared";
import { users } from "./auth";

/**
 * Comments, their reactions and their reports.
 *
 * **Polymorphic from day one.** Comments hang off `(subject_type, subject_id)`
 * rather than a `lesson_id`, so attaching them to exams or elements later is
 * an enum value, not a second table that duplicates threading, reactions,
 * moderation and pagination — and duplicates their bugs.
 */

export const commentSubjectEnum = pgEnum("comment_subject", ["lesson"]);

/**
 * `hidden` and `removed` differ in who did it and whether it comes back:
 * `hidden` is reversible moderation, `removed` is a decision. `flagged` is
 * still VISIBLE — it is a queue marker, not a punishment, because auto-hiding
 * on a heuristic hands anybody with four links a censor's button.
 */
export const commentStatusEnum = pgEnum("comment_status", [
  "visible",
  "hidden",
  "flagged",
  "removed",
]);

export const reactionTypeEnum = pgEnum("reaction_type", ["like", "dislike"]);

export const comments = pgTable(
  "comments",
  {
    id: id(),
    subjectType: commentSubjectEnum("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),

    /**
     * Threading is an adjacency list plus a materialised path, capped at one
     * level of reply.
     *
     * `WITH RECURSIVE` was the alternative and is wrong here — not for its
     * asymptotics, which Postgres handles, but because a recursive query
     * **cannot be paginated by keyset**. Showing page 2 of a tree means
     * materialising the whole tree and slicing it, so the cost grows with the
     * thread rather than with the page. That is precisely the failure mode on
     * the one lesson that goes viral.
     *
     * Capped, the read is two flat index-backed queries: a page of roots, then
     * replies for those roots. Replies to replies flatten to the parent thread
     * with an @mention, which on a phone reads better than four levels of
     * indentation anyway.
     */
    parentId: uuid("parent_id").references((): AnyPgColumn => comments.id, {
      onDelete: "cascade",
    }),
    rootId: uuid("root_id").references((): AnyPgColumn => comments.id, {
      onDelete: "cascade",
    }),
    /** `<rootId>` or `<rootId>/<id>`. Earns its place for moderation:
     * "remove this and everything under it" is one indexable `LIKE`, with no
     * recursion — and it stays cheap precisely because depth is capped, so
     * paths never grow. */
    path: text("path").notNull(),
    depth: smallint("depth").notNull().default(0),

    /** `set null`, not cascade: deleting an account must not delete the
     * answers other people were relying on. The row becomes authorless. */
    authorId: text("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    status: commentStatusEnum("status").notNull().default("visible"),

    /** Denormalised and maintained by triggers, never by application code —
     * the same rule as the lesson counters, for the same reason: `count + 1`
     * in a service drifts the moment a request dies between two writes. */
    likeCount: integer("like_count").notNull().default(0),
    dislikeCount: integer("dislike_count").notNull().default(0),
    replyCount: integer("reply_count").notNull().default(0),

    editedAt: timestamp("edited_at", { withTimezone: true }),
    /** Set on a tombstone. A comment with replies cannot be removed outright
     * without orphaning them, so the row survives with its body cleared. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /**
     * The feed index, matching the keyset query exactly: the partial predicate
     * is what keeps it small, since hidden and removed rows are never read by
     * the public query and top-level rows are a fraction of the table.
     */
    /**
     * Matches the feed's ORDER BY exactly — by id, not by timestamp.
     *
     * The ids are UUID v7, so ordering by id is ordering by time. The cursor
     * carries an id for the same reason: a timestamp round-tripped through
     * `toISOString()` loses the microseconds Postgres stores, and a keyset
     * predicate built on a truncated value returns an empty page for every
     * comment inside that millisecond.
     */
    index("comments_feed_idx")
      .on(t.subjectType, t.subjectId, t.id.desc())
      .where(sql`depth = 0 and status in ('visible', 'flagged')`),
    // Replies, oldest first: a thread reads in the order it happened, and by
    // id for the same reason as the feed above.
    index("comments_replies_idx").on(t.parentId, t.id),
    // `top`, by score. An expression index, because the score is not a column:
    // storing it would be a third counter to keep in step with two others.
    index("comments_top_idx").on(
      t.subjectType,
      t.subjectId,
      sql`(like_count - dislike_count) desc`,
      t.id.desc(),
    ),
    index("comments_author_idx").on(t.authorId, t.createdAt.desc()),
    /**
     * The cap, as a constraint rather than a convention.
     *
     * Application code that forgets it produces a depth-2 row that the reader
     * never sees — the query joins two levels — so the comment silently
     * vanishes instead of failing. A CHECK turns that into an error at the
     * insert that caused it.
     */
    check("comments_depth_cap", sql`depth <= 1`),
    /** A reply must name its parent and its root; a root must name neither.
     * Without this a malformed row reads as a top-level comment on the feed. */
    check(
      "comments_threading_coherent",
      sql`(depth = 0 and parent_id is null and root_id is null) or (depth = 1 and parent_id is not null and root_id is not null)`,
    ),
  ],
);

export const commentReactions = pgTable(
  "comment_reactions",
  {
    commentId: uuid("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * The type is a COLUMN, not part of the key.
     *
     * Switching from like to dislike is then an UPDATE of one row. Modelled as
     * two possible rows it would be a delete plus an insert, and two clicks
     * arriving together can interleave into both rows existing or neither —
     * a counter that drifts and a button that lies about its own state.
     */
    type: reactionTypeEnum("type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.commentId, t.userId] }),
    // Counting a comment's likes without scanning every reaction it has.
    index("comment_reactions_comment_idx").on(t.commentId, t.type),
  ],
);

export const commentReports = pgTable(
  "comment_reports",
  {
    id: id(),
    commentId: uuid("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    note: text("note"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /** One report per person per comment. Reporting twice is not twice as
     * urgent, and without this a single angry reader looks like a pile-on. */
    uniqueIndex("comment_reports_unique_idx").on(t.commentId, t.reporterId),
    // The moderation queue's only query: what is still open, oldest first.
    index("comment_reports_open_idx")
      .on(t.createdAt)
      .where(sql`resolved_at is null`),
  ],
);
