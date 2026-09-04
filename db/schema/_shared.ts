import { timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

/**
 * Conventions every table in this schema follows. Documented in
 * `docs/DATABASE.md`; import from here rather than restating them, so a change
 * of mind is one edit rather than twenty.
 */

/**
 * Primary key: a UUID v7 generated in application code.
 *
 * Not `serial`, which leaks row counts, enumerates trivially over a public API,
 * and forces a round trip before the id is known. Not v4 either: v7 is
 * time-ordered, so index writes stay at the right-hand edge of the B-tree and
 * rows sort by insertion order for free.
 */
export const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());

/**
 * `updated_at` is maintained by Drizzle rather than a database trigger, so the
 * behaviour is visible in TypeScript instead of hidden in the schema.
 */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
