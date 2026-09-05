import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { users } from "./auth";

/**
 * Who was here, and when.
 *
 * **A separate table, not a column on `users`.** A row updated every sixty
 * seconds per online user would churn the users table: bloat for autovacuum,
 * and an invalidation in every cache that reads a profile — for a green dot.
 * Here the churn is confined to a table nothing else reads.
 *
 * There is no `is_online` boolean anywhere, and that is the design rather than
 * an omission. A stored boolean survives a browser being closed without a
 * clean disconnect, which is the common case; a timestamp resolves a crashed
 * tab, a lost connection and a shut laptop correctly with no cleanup job.
 */

/**
 * `presenceVisibilityEnum` lives in `auth.ts`, beside the column that uses it:
 * this module already imports `users` from there, and declaring it here would
 * make the two files import each other.
 */

export const userPresence = pgTable(
  "user_presence",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * A coarse route pattern — `/lessons/[slug]`, never a URL with a query
     * string. Admin-only, and deliberately not shown to other readers:
     * "Sara is reading Atomic Structure" is a far larger step than a green
     * dot, and it is not what was asked for.
     */
    lastPath: text("last_path"),
  },
  (t) => [
    // The admin list sorts by it, and the read path filters on it.
    index("user_presence_last_seen_idx").on(t.lastSeenAt.desc()),
  ],
);
