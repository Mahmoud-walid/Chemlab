import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { allPermissionNames } from "@/db/seed/rbac";
import { mediaFolder, mediaPublicId } from "@/lib/media/paths";

/**
 * The media tables, against real Postgres.
 *
 * What needs a database rather than a type check: the reference model. An
 * asset's whole reason for having rows is that Cloudinary cannot answer "is
 * anything still using this" — and every claim below about what survives a
 * delete is a foreign key or a primary key, not a line of TypeScript.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

const OWNER = `media-owner-${uuidv7()}`;
const ENVIRONMENT = `test-${uuidv7().slice(0, 8)}`;

let mediaId: string;

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  await db.insert(schema.users).values({
    id: OWNER,
    name: "Uploader",
    email: `${OWNER}@media-test.invalid`,
  });
});

afterAll(async () => {
  await db
    .delete(schema.media)
    .where(eq(schema.media.environment, ENVIRONMENT));
  await db.delete(schema.users).where(eq(schema.users.id, OWNER));
  await close?.();
});

async function anAsset(overrides: Record<string, unknown> = {}) {
  const folder = mediaFolder({
    environment: ENVIRONMENT,
    kind: "lessons",
    entityId: "lesson-1",
  });
  const [row] = await db
    .insert(schema.media)
    .values({
      publicId: mediaPublicId(folder),
      resourceType: "image",
      environment: ENVIRONMENT,
      folder,
      ownerId: OWNER,
      ...overrides,
    })
    .returning({ id: schema.media.id });
  return row!.id;
}

beforeEach(async () => {
  await db
    .delete(schema.media)
    .where(eq(schema.media.environment, ENVIRONMENT));
  mediaId = await anAsset();
});

describe("an asset row", () => {
  it("starts pending, because the upload has not happened yet", async () => {
    // The row is written when the signature is issued, and the upload may
    // never follow: the tab closes, the network drops, Cloudinary's own preset
    // refuses the file. An asset is usable only once something confirmed it.
    const [row] = await db
      .select({ status: schema.media.status, bytes: schema.media.bytes })
      .from(schema.media)
      .where(eq(schema.media.id, mediaId));

    expect(row?.status).toBe("pending");
    // And knows nothing about the file yet. These come from Cloudinary's
    // signed response, never from what the client says it uploaded.
    expect(row?.bytes).toBeNull();
  });

  it("refuses a second row for the same public id", async () => {
    // Two rows for one Cloudinary asset means a delete that leaves the other
    // pointing at nothing, and an orphan sweep that disagrees with itself.
    const [existing] = await db
      .select({ publicId: schema.media.publicId })
      .from(schema.media)
      .where(eq(schema.media.id, mediaId));

    await expect(
      db.insert(schema.media).values({
        publicId: existing!.publicId,
        resourceType: "image",
        environment: ENVIRONMENT,
        folder: "whatever",
      }),
    ).rejects.toThrow();
  });

  it("outlives the account that uploaded it", async () => {
    // `set null`, not `cascade`. Deleting a contributor's account must not
    // take a published lesson's illustrations off the page with it.
    const solo = `media-temp-${uuidv7()}`;
    await db.insert(schema.users).values({
      id: solo,
      name: "Leaving",
      email: `${solo}@media-test.invalid`,
    });
    const owned = await anAsset({ ownerId: solo });

    await db.delete(schema.users).where(eq(schema.users.id, solo));

    const [row] = await db
      .select({ ownerId: schema.media.ownerId })
      .from(schema.media)
      .where(eq(schema.media.id, owned));
    expect(row).toBeDefined();
    expect(row?.ownerId).toBeNull();
  });
});

describe("usages", () => {
  it("lets one asset be referenced by two different things", async () => {
    // The reason this is a join table and not a column: a picture in a lesson
    // and in its Arabic translation is one file with two references, and
    // "is anything still using this" has to have one answer.
    await db.insert(schema.mediaUsages).values([
      { mediaId, kind: "lesson_block", entityId: "lesson-1", blockId: "b1" },
      { mediaId, kind: "lesson_block", entityId: "lesson-2", blockId: "b1" },
    ]);

    const rows = await db
      .select()
      .from(schema.mediaUsages)
      .where(eq(schema.mediaUsages.mediaId, mediaId));
    expect(rows).toHaveLength(2);
  });

  it("counts two blocks in the same lesson as two references", async () => {
    // Without `block_id` in the key, a lesson could use a picture only once —
    // and removing one of the two blocks would look like removing the last
    // reference.
    await db.insert(schema.mediaUsages).values([
      { mediaId, kind: "lesson_block", entityId: "lesson-1", blockId: "b1" },
      { mediaId, kind: "lesson_block", entityId: "lesson-1", blockId: "b2" },
    ]);

    const rows = await db
      .select()
      .from(schema.mediaUsages)
      .where(eq(schema.mediaUsages.mediaId, mediaId));
    expect(rows).toHaveLength(2);
  });

  it("refuses the same reference twice", async () => {
    const usage = {
      mediaId,
      kind: "lesson_block" as const,
      entityId: "lesson-1",
      blockId: "b1",
    };
    await db.insert(schema.mediaUsages).values(usage);
    await expect(db.insert(schema.mediaUsages).values(usage)).rejects.toThrow();
  });

  it("accepts a reference with no block, such as a cover or an avatar", async () => {
    // `block_id` defaults to `''` rather than null precisely so this insert
    // works: Postgres makes every primary-key column NOT NULL whether or not
    // the schema says so, and a null here would fail on every cover image.
    await db
      .insert(schema.mediaUsages)
      .values({ mediaId, kind: "lesson_cover", entityId: "lesson-1" });

    const [row] = await db
      .select({ blockId: schema.mediaUsages.blockId })
      .from(schema.mediaUsages)
      .where(
        and(
          eq(schema.mediaUsages.mediaId, mediaId),
          eq(schema.mediaUsages.kind, "lesson_cover"),
        ),
      );
    expect(row?.blockId).toBe("");
  });

  it("goes when the asset goes", async () => {
    // A usage pointing at a deleted asset is a dangling reference the orphan
    // sweep would have to reason about. The cascade is what says it cannot
    // happen.
    await db
      .insert(schema.mediaUsages)
      .values({ mediaId, kind: "lesson_cover", entityId: "lesson-1" });

    await db.delete(schema.media).where(eq(schema.media.id, mediaId));

    const rows = await db
      .select()
      .from(schema.mediaUsages)
      .where(eq(schema.mediaUsages.mediaId, mediaId));
    expect(rows).toEqual([]);
  });
});

describe("the orphan query the clean-up will run", () => {
  it("finds an asset nothing refers to, and not one that is referenced", async () => {
    const referenced = await anAsset();
    await db
      .insert(schema.mediaUsages)
      .values({ mediaId: referenced, kind: "lesson_cover", entityId: "l" });

    const orphans = await db.execute<{ id: string }>(sql`
      select m.id
      from media m
      where m.environment = ${ENVIRONMENT}
        and m.deleted_at is null
        and not exists (
          select 1 from media_usages u where u.media_id = m.id
        )
    `);

    const ids = orphans.rows.map((row) => row.id);
    expect(ids).toContain(mediaId);
    expect(ids).not.toContain(referenced);
  });
});

describe("the video permission", () => {
  it("exists in the catalogue", () => {
    expect(allPermissionNames()).toContain("media:upload_video");
  });

  it("is held by the roles that write content, and by no other", async () => {
    // Video is billed per rendition and per viewer: one lesson video watched
    // by a class can outweigh every image on the platform. Whether a NORMAL
    // account may ever upload one is Q41, and until it is answered the
    // default is no.
    const rows = await db.execute<{ key: string }>(sql`
      select r.key
      from roles r
      join role_permissions rp on rp.role_id = r.id
      join permissions p on p.id = rp.permission_id
      where p.name = 'media:upload_video'
      order by r.key
    `);

    expect(rows.rows.map((row) => row.key)).toEqual(["admin", "editor"]);
  });
});
