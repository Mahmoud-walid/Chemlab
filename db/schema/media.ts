import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
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

/**
 * Uploaded media: what is in the Cloudinary account, and what refers to it.
 *
 * The reason this needs tables at all is that Cloudinary is not a database.
 * Its console can list what exists; it cannot answer "which lesson is this
 * picture in", "who uploaded it", or "is anything still using it" — and
 * without those answers, deleting a byte is a guess. So every asset has a row,
 * every reference to an asset has a row, and the two together are what make
 * reclamation safe.
 *
 * **No file ever transits this server.** The browser uploads straight to
 * Cloudinary and the server only signs the request that authorises it, because
 * a serverless function has a body limit measured in single-digit megabytes
 * and a lesson video is not. That is why `bytes`, `width` and `format` are
 * nullable at insert: the row is written before the upload happens, and filled
 * in from Cloudinary's own signed response afterwards — never from what the
 * client claims it uploaded.
 */

export const mediaResourceType = pgEnum("media_resource_type", [
  "image",
  "video",
  "raw",
]);

/**
 * `pending` is the honest default. A row is created when the upload is signed,
 * and the upload may never happen — the author closes the tab, the network
 * drops, the file is rejected by Cloudinary's own preset. An asset is usable
 * only once something has confirmed it exists.
 */
export const mediaStatus = pgEnum("media_status", [
  "pending",
  "ready",
  "failed",
  "deleted",
]);

/** Where a reference lives. Each value names a table and a column that points
 * at an asset, so an orphan check is one join rather than a survey. */
export const mediaUsageKind = pgEnum("media_usage_kind", [
  "lesson_block",
  "lesson_cover",
  "question",
  "answer_option",
  "avatar",
]);

export const media = pgTable(
  "media",
  {
    id: id(),

    /** Cloudinary's identifier, folder path included. The address and the
     * name: two public ids are two assets. */
    publicId: text("public_id").notNull(),
    resourceType: mediaResourceType("resource_type").notNull(),
    /** `upload`, `private`, `authenticated` — Cloudinary's delivery type,
     * which is part of every URL. Stored rather than assumed, because a URL
     * built with the wrong one 404s. */
    deliveryType: text("delivery_type").notNull().default("upload"),

    /**
     * Everything below comes from Cloudinary AFTER the upload, and is null
     * until then. A client-supplied width is a client-supplied width.
     */
    format: text("format"),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    bytes: bigint("bytes", { mode: "number" }),

    /** A still from the video, so the player never opens on a black box. */
    posterPublicId: text("poster_public_id"),
    /** A 16px blurred copy, inlined as a data URL. One transformation, ever,
     * and zero requests at render — which is the whole point of storing the
     * bytes rather than the URL. */
    blurDataUrl: text("blur_data_url"),

    /** Required before an image may be attached to anything a reader sees.
     * Nullable here because the row exists before anybody has written it. */
    alt: text("alt"),
    /** What the author called the file. Display only — never used to build a
     * path, because a name from a browser is arbitrary bytes. */
    originalFilename: text("original_filename"),

    /**
     * Which deployment uploaded this, from `CLOUDINARY_UPLOAD_FOLDER` rather
     * than from `NODE_ENV`. A preview deployment runs a production build and
     * `NODE_ENV` says "production" there, which is exactly how a preview's
     * uploads end up in the production folder and its clean-up takes real
     * content with it.
     */
    environment: text("environment").notNull(),
    folder: text("folder").notNull(),

    /** `set null`, not `cascade`: an account being deleted must not take a
     * published lesson's illustrations with it. The asset outlives the
     * uploader, and the row stops naming them. */
    ownerId: text("owner_id").references(() => users.id, {
      onDelete: "set null",
    }),

    status: mediaStatus("status").notNull().default("pending"),
    /** Cloudinary's etag. Two identical uploads are one file paid for twice,
     * and this is how the second is recognised. */
    checksum: text("checksum"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Soft delete. The remote asset is destroyed later, by a job, because a
     * lesson delete is often a mistake and a destroy call is not undoable —
     * and because the same asset may still be referenced by a translation. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("media_public_id_idx").on(t.publicId),
    index("media_owner_idx").on(t.ownerId, t.createdAt.desc()),
    // The reclamation query: pending or ready rows, oldest first, that nothing
    // has soft-deleted yet. Partial, because a deleted row is never a
    // candidate for the orphan sweep — it is already on the other list.
    index("media_gc_idx")
      .on(t.status, t.createdAt)
      .where(sql`deleted_at is null`),
  ],
);

/**
 * What refers to an asset.
 *
 * A join table rather than a foreign key on each consumer, because an asset
 * can be used by several things at once — a picture in two lessons, or in a
 * lesson and its Arabic translation — and "is anything still using this" has
 * to be one question with one answer. A refcount kept as a column would be a
 * number that drifts; a row per reference cannot.
 */
export const mediaUsages = pgTable(
  "media_usages",
  {
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    kind: mediaUsageKind("kind").notNull(),
    /** The lesson, question or user this reference belongs to. Deliberately
     * untyped by a foreign key: it points into five different tables, and a
     * column cannot reference five. The `kind` says which. */
    entityId: text("entity_id").notNull(),
    /**
     * Which block within the lesson, when `kind` is `lesson_block`. Two blocks
     * in one lesson using the same picture are two references, which is why it
     * is part of the key.
     *
     * `''` rather than null for "no block", because Postgres makes every
     * primary-key column NOT NULL whether or not the schema says so — a
     * nullable column in the key is a constraint that silently disagrees with
     * its own declaration, and every cover image would fail to insert.
     */
    blockId: text("block_id").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The same asset in the same block twice is one usage, not two. Without
    // `block_id` in the key, a lesson could reference a picture only once.
    primaryKey({
      columns: [t.mediaId, t.kind, t.entityId, t.blockId],
      name: "media_usages_pkey",
    }),
    index("media_usages_entity_idx").on(t.kind, t.entityId),
  ],
);

/**
 * How much one person may upload.
 *
 * A row per user rather than a `sum(bytes)` over `media`, because the check
 * runs before every signature is issued and a sum over a growing table is a
 * scan on the hot path. The cost is that the number can drift from reality;
 * `scripts/media-gc.ts` is where it gets reconciled.
 */
export const userMediaQuota = pgTable("user_media_quota", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  bytesUsed: bigint("bytes_used", { mode: "number" }).notNull().default(0),
  /** No default: what a normal account may store is a product decision with a
   * cost attached, recorded as Q43. A row is written when somebody is given a
   * quota, and its absence means the platform default applies. */
  bytesLimit: bigint("bytes_limit", { mode: "number" }).notNull(),
  uploadsToday: integer("uploads_today").notNull().default(0),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
