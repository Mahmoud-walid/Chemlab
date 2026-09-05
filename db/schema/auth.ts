import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { id, timestamps } from "./_shared";

/**
 * Identity.
 *
 * The first four tables mirror what Better Auth expects, declared here rather
 * than left to the library so they are migrated by drizzle-kit like every
 * other table: the library never owns our migrations. Their shape is dictated
 * by the library — field names, nullability and the `issuer` column included —
 * so do not "tidy" them without checking `getAuthTables()` first.
 *
 * Ids are `text`, not our usual `uuid`. Better Auth generates ids itself, and
 * accepting its type is cheaper than fighting the library at every insert; a
 * custom `generateId` in `lib/auth.ts` still returns UUID v7, so they stay
 * time-ordered. Our own tables below keep the `uuid` convention and reference
 * `users.id` as text.
 */

/**
 * Who may see somebody's presence.
 *
 * Declared here rather than in `presence.ts` because the column is here, and
 * `presence.ts` already imports `users` — the other direction would be a
 * cycle.
 */
export const presenceVisibilityEnum = pgEnum("presence_visibility", [
  "everyone",
  "nobody",
]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  /**
   * Who may see this person's presence.
   *
   * Defaulted to `everyone` because that is what was asked for, and kept as a
   * ONE-LINE change because it is the kind of default worth revisiting: an
   * always-public presence signal on a learning site tells anyone watching
   * when a particular student is at their desk and when they stop. Recorded as
   * Q39 in docs/DEFERRED_QUESTIONS.md.
   *
   * `nobody` is enforced in SQL, not in the client — see the presence view.
   */
  presenceVisibility: presenceVisibilityEnum("presence_visibility")
    .notNull()
    .default("everyone"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * A row here IS the session. Deleting it revokes access — which is the whole
 * reason for database sessions over stateless JWTs, whose stale claims survive
 * until expiry no matter what an admin does.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/**
 * One row per credential or provider, all pointing at the same `user_id`.
 *
 * Account linking is a SECOND ROW here, never a second `users` row — that
 * distinction is what keeps one person one account when they sign in with
 * Google after having registered a password.
 *
 * `password` holds a memory-hard hash and only for `provider_id = 'credential'`.
 * Better Auth strips it, and every other token column, from account output;
 * nothing in our code should ever select this table into a response.
 */
export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    issuer: text("issuer").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One account per provider subject: without this, a race could attach the
    // same Google identity to two users.
    uniqueIndex("accounts_provider_account_idx").on(t.providerId, t.accountId),
    index("accounts_user_idx").on(t.userId),
  ],
);

/** Email-verification and password-reset tokens. Single use, short-lived. */
export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

// ── Ours ────────────────────────────────────────────────────────────────────

export const localeEnum = pgEnum("locale", ["en", "ar"]);

/**
 * A separate table rather than columns on `users`, so Better Auth's table can
 * be regenerated on upgrade without clobbering our fields. The cost is one
 * join, paid in one place by `getCurrentUser()`.
 */
export const profiles = pgTable("profiles", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  /**
   * A plain string, deliberately: today it holds a Google URL, later a
   * Cloudinary one. Shaping the column around either provider would have to be
   * migrated when the other arrives.
   */
  avatarUrl: text("avatar_url"),
  avatarSource: text("avatar_source"),
  bio: text("bio"),
  locale: localeEnum("locale").notNull().default("en"),
  ...timestamps,
});

/**
 * Credential sign-in rate limiting.
 *
 * `key` is a HASH of the email or IP, never the raw value: this table would
 * otherwise become a list of everyone who has ever tried to sign in, and a
 * breach of it would leak addresses the users never published.
 */
export const authAttempts = pgTable(
  "auth_attempts",
  {
    id: id(),
    key: text("key").notNull(),
    kind: text("kind").notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    succeeded: boolean("succeeded").notNull().default(false),
  },
  (t) => [index("auth_attempts_key_time_idx").on(t.key, t.attemptedAt)],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
