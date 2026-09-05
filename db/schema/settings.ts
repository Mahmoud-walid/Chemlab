import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Runtime product configuration, one row per key.
 *
 * **Not one jsonb blob.** A blob makes partial validation impossible, turns
 * every concurrent edit into a lost update — two operators on different tabs,
 * one silently overwriting the other's whole document — and offers no place to
 * hang a per-key permission. One row per key gives all three, at the cost of a
 * slightly noisier read, and this table has tens of rows rather than thousands.
 *
 * A missing row is not an error: the registry in `lib/settings/registry.ts`
 * carries the default, so a fresh database boots with a working app and
 * nothing to seed. That means a row exists only where somebody changed
 * something, which also makes "what has been customised" a `SELECT *`.
 *
 * **No secret ever lives here.** Secrets are environment variables; this is
 * product configuration. `tests/lib/settings-registry.test.ts` asserts no key
 * name even looks like a credential, which is what makes recording old and new
 * values in the activity stream safe by construction.
 */
export const settings = pgTable("settings", {
  /** Dotted, `section.name` — the registry is the source of truth for shape. */
  key: text("key").primaryKey(),

  /**
   * The value as jsonb, validated against the registry's zod schema on write.
   * jsonb rather than text so a boolean stays a boolean and a list stays a
   * list, instead of every read having to guess how to parse it back.
   *
   * **Nullable**, because null is a legitimate value: a cleared contact
   * address is set to nothing, and that is different from never having been
   * set. `NOT NULL` here made it impossible to store — caught by a test rather
   * than by someone clearing the field in production.
   *
   * "No row" and "row holding null" stay distinguishable: a row has an
   * `updated_at`, and the resolved shape reports that as null when it is
   * serving a registry default.
   */
  value: jsonb("value"),

  /**
   * Sent back by the form and compared on write, so a stale tab reports a
   * conflict rather than quietly overwriting someone else's change.
   */
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedBy: text("updated_by"),
});

export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
