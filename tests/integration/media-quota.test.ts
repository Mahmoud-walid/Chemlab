import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import {
  releaseQuota,
  reserveQuota,
  settleQuota,
} from "@/db/queries/media-quota";
import { MEDIA_QUOTA_BYTES } from "@/lib/media/quota";

/**
 * The quota reservation, against real Postgres.
 *
 * Here rather than in the unit suite because the thing worth proving is not the
 * arithmetic — `tests/lib/media-quota.test.ts` already covers that, exhaustively
 * and without a database. What needs real Postgres is that the check and the
 * increment cannot be interleaved. A mocked `db` will happily run two
 * "concurrent" calls one after the other and report that the lock works.
 */

const MB = 1024 * 1024;

let db: SeedDatabase;
let close: () => Promise<void>;

/** One account per test, because every assertion here is about a running
 * total — a shared user would make the suite order-dependent, and CI shuffles
 * (§6). */
let userId: string;

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));
});

afterAll(async () => {
  await close?.();
});

async function anAccount(): Promise<string> {
  const id = `quota-${uuidv7()}`;
  await db.insert(schema.users).values({
    id,
    name: "Uploader",
    email: `${id}@quota-test.invalid`,
  });
  return id;
}

/** The stored row, read outside any of the functions under test. */
async function storedQuota(id: string) {
  const [row] = await db
    .select({
      bytesUsed: schema.userMediaQuota.bytesUsed,
      bytesLimit: schema.userMediaQuota.bytesLimit,
    })
    .from(schema.userMediaQuota)
    .where(eq(schema.userMediaQuota.userId, id));
  return row;
}

beforeEach(async () => {
  userId = await anAccount();
});

describe("the first reservation", () => {
  it("creates the row at the platform default, because bytes_limit has none", async () => {
    // `bytes_limit` is NOT NULL with no database default on purpose (Q43): a
    // row means a specific allowance was granted, and its absence means the
    // default applies. So the first upload has to write one.
    expect(await storedQuota(userId)).toBeUndefined();

    const outcome = await reserveQuota(db, {
      userId,
      bytes: MB,
      holdsMediaCreate: true,
    });

    expect(outcome.ok).toBe(true);
    expect(await storedQuota(userId)).toEqual({
      bytesUsed: MB,
      bytesLimit: MEDIA_QUOTA_BYTES.author,
    });
  });

  it("gives a member the smaller default", async () => {
    await reserveQuota(db, { userId, bytes: MB, holdsMediaCreate: false });

    expect((await storedQuota(userId))?.bytesLimit).toBe(
      MEDIA_QUOTA_BYTES.member,
    );
  });

  it("never overwrites an allowance somebody was given", async () => {
    // An operator who lowered a limit must not have it reset to the default by
    // the account's next upload.
    await db.insert(schema.userMediaQuota).values({
      userId,
      bytesUsed: 0,
      bytesLimit: 5 * MB,
    });

    await reserveQuota(db, { userId, bytes: MB, holdsMediaCreate: true });

    expect((await storedQuota(userId))?.bytesLimit).toBe(5 * MB);
  });
});

describe("a reservation that does not fit", () => {
  it("is refused and leaves the total untouched", async () => {
    await db.insert(schema.userMediaQuota).values({
      userId,
      bytesUsed: 9 * MB,
      bytesLimit: 10 * MB,
    });

    const outcome = await reserveQuota(db, {
      userId,
      bytes: 2 * MB,
      holdsMediaCreate: false,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.refusals).toEqual(["over-quota"]);
    // The refusal reports the CURRENT total, so the caller can say how much
    // room there is without a second read.
    expect(outcome.bytesUsed).toBe(9 * MB);
    // The room the account actually has, not the zero that would be left after
    // an upload that is not happening. This is what lets the message name a
    // number: 1 MB left, and the file was 2 MB.
    expect(outcome.bytesRemaining).toBe(MB);
    expect((await storedQuota(userId))?.bytesUsed).toBe(9 * MB);
  });
});

describe("many uploads at the same moment", () => {
  /**
   * The test this module exists for — and the shape of it was decided by
   * measurement rather than by what reads well.
   *
   * Two things that looked like the obvious tests do NOT catch a missing
   * `for update`, and both were written, run against the mutant, and deleted:
   *
   * - **Two concurrent reservations that only fit one at a time.** Against local
   *   Postgres two `Promise.all` calls usually complete sequentially, so the
   *   overrun never happens and the test is green with the lock removed.
   * - **A competing transaction holding the row, to force the interleaving.**
   *   Also green without the lock, for a reason worth keeping: `reserveQuota`
   *   opens with `insert ... on conflict do nothing`, which has to probe the
   *   primary-key index, so it BLOCKS on the held row by itself. The unlocked
   *   `select` then reads committed data and refuses correctly. The insert was
   *   quietly acting as the barrier the test thought it was providing.
   *
   * What does catch it is the lost update. Enough contenders that they really
   * do overlap, and an invariant no interleaving can satisfy by luck: the
   * stored total must equal the bytes actually handed out. Read-modify-write
   * without a lock drops increments, so the total comes out lower than the
   * successes — and the account gets space it was never granted.
   */
  it("hands out exactly the bytes it records, and never more than the limit", async () => {
    const LIMIT = 5 * MB;
    const CONTENDERS = 8;

    await db.insert(schema.userMediaQuota).values({
      userId,
      bytesUsed: 0,
      bytesLimit: LIMIT,
    });

    const outcomes = await Promise.all(
      Array.from({ length: CONTENDERS }, () =>
        reserveQuota(db, { userId, bytes: MB, holdsMediaCreate: false }),
      ),
    );

    const granted = outcomes.filter((o) => o.ok).length;
    const stored = (await storedQuota(userId))?.bytesUsed;

    // The invariant that fails without the lock: eight contenders for five
    // megabytes, and the row must account for every megabyte given away.
    expect(stored).toBe(granted * MB);
    // And the limit is a limit, not a suggestion.
    expect(stored).toBeLessThanOrEqual(LIMIT);
    // Exactly the capacity, so a lock that serialised by refusing everybody
    // would fail here rather than look like success.
    expect(granted).toBe(5);
  });
});

describe("releasing bytes", () => {
  it("gives them back", async () => {
    await db.insert(schema.userMediaQuota).values({
      userId,
      bytesUsed: 5 * MB,
      bytesLimit: 10 * MB,
    });

    await releaseQuota(db, { userId, bytes: 2 * MB });

    expect((await storedQuota(userId))?.bytesUsed).toBe(3 * MB);
  });

  it("floors at zero, so a double release cannot grant free space", async () => {
    await db.insert(schema.userMediaQuota).values({
      userId,
      bytesUsed: MB,
      bytesLimit: 10 * MB,
    });

    await releaseQuota(db, { userId, bytes: MB });
    await releaseQuota(db, { userId, bytes: MB });

    // Not -1 MB. A negative total would read as a megabyte of free space on
    // the next check.
    expect((await storedQuota(userId))?.bytesUsed).toBe(0);
  });
});

describe("settling against the size Cloudinary reported", () => {
  it("returns headroom when the file was smaller than claimed", async () => {
    await db.insert(schema.userMediaQuota).values({
      userId,
      bytesUsed: 10 * MB,
      bytesLimit: 100 * MB,
    });

    const settled = await settleQuota(db, {
      userId,
      reservedBytes: 10 * MB,
      actualBytes: 4 * MB,
    });

    expect(settled.bytesUsed).toBe(4 * MB);
    expect(settled.overQuota).toBe(false);
  });

  it("goes OVER the limit when the file was understated, and says so", async () => {
    // The lie that matters: understate a file to slip past the check. It is not
    // prevented at signing time — nobody knows the real size yet — it is undone
    // here, against Cloudinary's signed number.
    //
    // The stored total must follow reality even when reality is over the limit.
    // Refusing the correction would leave the total lower than the bytes that
    // actually exist, which makes every later check wrong in the uploader's
    // favour.
    await db.insert(schema.userMediaQuota).values({
      userId,
      bytesUsed: 9 * MB,
      bytesLimit: 10 * MB,
    });

    const settled = await settleQuota(db, {
      userId,
      reservedBytes: MB,
      actualBytes: 50 * MB,
    });

    expect(settled.bytesUsed).toBe(58 * MB);
    expect(settled.overQuota).toBe(true);
    expect((await storedQuota(userId))?.bytesUsed).toBe(58 * MB);
  });

  it("cannot be driven negative by a confirm that arrives twice", async () => {
    // A confirm webhook is retried, or a reservation is settled after it was
    // already released. The correction is then larger than the total it is
    // correcting: 1 + 1 - 5 is negative, and a negative total reads as free
    // space on the next check — the same failure `releaseQuota` floors against.
    await db.insert(schema.userMediaQuota).values({
      userId,
      bytesUsed: 5 * MB,
      bytesLimit: 10 * MB,
    });

    const first = await settleQuota(db, {
      userId,
      reservedBytes: 5 * MB,
      actualBytes: MB,
    });
    expect(first.bytesUsed).toBe(MB);

    const replay = await settleQuota(db, {
      userId,
      reservedBytes: 5 * MB,
      actualBytes: MB,
    });

    expect(replay.bytesUsed).toBe(0);
    expect((await storedQuota(userId))?.bytesUsed).toBe(0);
  });

  it("refuses the next upload once an overrun is recorded", async () => {
    // What `overQuota` is for: the overrun is absorbed, and then the account is
    // closed for business until somebody deletes something.
    await db.insert(schema.userMediaQuota).values({
      userId,
      bytesUsed: 58 * MB,
      bytesLimit: 10 * MB,
    });

    const outcome = await reserveQuota(db, {
      userId,
      bytes: 1,
      holdsMediaCreate: false,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.bytesRemaining).toBe(0);
  });
});
