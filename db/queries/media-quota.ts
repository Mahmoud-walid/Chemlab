import { eq, sql } from "drizzle-orm";

import type { AnyDatabase } from "@/db/any-database";
import { userMediaQuota } from "@/db/schema/media";
import {
  checkQuota,
  defaultQuotaBytes,
  type QuotaRefusal,
} from "@/lib/media/quota";

/**
 * Claiming and returning bytes against `user_media_quota`.
 *
 * `lib/media/quota.ts` decides the policy and is pure. This is the half that
 * touches the database, and it exists as its own module because the dangerous
 * part of a quota is not the comparison — it is that the comparison and the
 * increment have to be **one atomic step**. Read the total, decide, then add:
 * two uploads that read at the same moment both see room and both write, and
 * the account ends up over its limit by the size of the second file. Nothing
 * about the arithmetic being correct prevents that.
 *
 * Reserved at signing time and settled afterwards, which is the only order
 * available: the file never touches this server (see `docs/MEDIA.md`), so the
 * real size is known only once Cloudinary reports it.
 */

/** What a reservation answers. `bytesRemaining` is a number rather than a flag
 * because "no space" and "84 MB left of 2 GB" are different sentences to show
 * an author. */
export interface QuotaOutcome {
  ok: boolean;
  refusals: QuotaRefusal[];
  /** The total AFTER a successful reservation, or the unchanged total when
   * refused — so a caller can render the reason without a second read. */
  bytesUsed: number;
  bytesLimit: number;
  bytesRemaining: number;
}

/**
 * Claims `bytes` if they fit, atomically.
 *
 * The lock is the whole point, so it is worth saying what each part prevents.
 *
 * **Why a transaction with `for update` rather than one conditional `UPDATE`.**
 * A single statement — `set bytes_used = bytes_used + $n where bytes_used + $n
 * <= bytes_limit` — would be atomic and shorter, and it was rejected: it writes
 * the policy a second time, in SQL, where it can drift from `checkQuota()`
 * without either copy looking wrong. A quota that disagrees with itself
 * depending on which layer you ask is worse than one round trip. So the row is
 * locked, `checkQuota()` decides as the only decider, and the write follows.
 *
 * **Why `for update` and NOT `for update skip locked`.** The push queue and the
 * notification fan-out use `skip locked` because two drains must not claim the
 * same row — skipping is the correct answer there. Here skipping would mean the
 * second uploader's transaction proceeds *without having seen* the first one's
 * increment, which is precisely the overrun this function exists to stop. The
 * same clause, opposite reasons: one wants the contenders to miss each other,
 * this one needs them to queue.
 *
 * **Why the row is created here.** `bytes_limit` is `NOT NULL` with no database
 * default on purpose (Q43): a row means somebody was given a specific
 * allowance, and its absence means the platform default applies. So a
 * first-time uploader has no row, and one is inserted at the default rather
 * than the caller having to remember to. Inside the transaction, because a row
 * inserted afterwards is a row the lock below never saw.
 */
export async function reserveQuota(
  db: AnyDatabase,
  {
    userId,
    bytes,
    holdsMediaCreate,
  }: { userId: string; bytes: number; holdsMediaCreate: boolean },
): Promise<QuotaOutcome> {
  return db.transaction(async (tx) => {
    await tx
      .insert(userMediaQuota)
      .values({
        userId,
        bytesUsed: 0,
        bytesLimit: defaultQuotaBytes(holdsMediaCreate),
      })
      .onConflictDoNothing({ target: userMediaQuota.userId });

    const [row] = await tx
      .select({
        bytesUsed: userMediaQuota.bytesUsed,
        bytesLimit: userMediaQuota.bytesLimit,
      })
      .from(userMediaQuota)
      .where(eq(userMediaQuota.userId, userId))
      .for("update");

    // Unreachable through the insert above; asserted rather than defaulted,
    // because silently treating a missing row as an empty quota would hand out
    // the platform default to a user whose row was deliberately lowered.
    if (!row) throw new Error(`no quota row for ${userId}`);

    const verdict = checkQuota({
      bytesUsed: row.bytesUsed,
      bytesLimit: row.bytesLimit,
      bytes,
    });

    if (verdict.refusals.length > 0) {
      return {
        ok: false,
        refusals: verdict.refusals,
        bytesUsed: row.bytesUsed,
        bytesLimit: row.bytesLimit,
        // NOT `verdict.bytesRemaining`. `checkQuota` reports what is left AFTER
        // the upload, which on a refusal is always zero — true, and useless to
        // show somebody. What an author needs is the room they actually have, so
        // the message can be "1 MB left, and that file is 2 MB" rather than a
        // bare "no space".
        bytesRemaining: Math.max(0, row.bytesLimit - row.bytesUsed),
      };
    }

    await tx
      .update(userMediaQuota)
      .set({ bytesUsed: row.bytesUsed + bytes })
      .where(eq(userMediaQuota.userId, userId));

    return {
      ok: true,
      refusals: [],
      bytesUsed: row.bytesUsed + bytes,
      bytesLimit: row.bytesLimit,
      bytesRemaining: verdict.bytesRemaining,
    };
  });
}

/**
 * Gives bytes back — an upload that was signed and never happened, or an asset
 * whose bytes have actually been reclaimed.
 *
 * Floored at zero in SQL rather than read-then-write, for the same reason
 * `reserveQuota` locks: `greatest(0, bytes_used - $n)` cannot be raced, and it
 * makes a double release idempotent at the boundary instead of driving the
 * total negative. A negative allowance has no honest rendering, and it would
 * silently grant the account free space.
 *
 * Deliberately NOT the reverse of a reservation in one respect: it never
 * refuses. By the time this is called the decision has already been taken
 * elsewhere, and a release that can fail is a release that leaks quota.
 */
export async function releaseQuota(
  db: AnyDatabase,
  { userId, bytes }: { userId: string; bytes: number },
): Promise<void> {
  await db
    .update(userMediaQuota)
    .set({
      bytesUsed: sql`greatest(0, ${userMediaQuota.bytesUsed} - ${bytes})`,
    })
    .where(eq(userMediaQuota.userId, userId));
}

/**
 * Corrects a reservation once Cloudinary has reported the real size.
 *
 * A reservation is made against the size the CLIENT claimed, because at signing
 * time that is the only number in existence. That is safe, and not because the
 * claim is trusted:
 *
 * - claiming **more** than the file turns out to be only costs the claimant
 *   headroom, and this call returns it;
 * - claiming **less** is corrected here against Cloudinary's *signed* response,
 *   which is the only size this system treats as authoritative.
 *
 * So the lie that matters — understating a file to slip past the quota — is
 * undone at confirm rather than prevented at sign, and the reason it cannot be
 * prevented at sign is that nobody knows the real size yet.
 *
 * **This can push an account over its limit, and it must.** The file already
 * exists in the account by now; refusing the adjustment would leave the stored
 * total lower than reality, which is the one outcome that makes every later
 * check wrong. It reports `overQuota` instead, so the caller can refuse the
 * NEXT upload and, where the overrun is large enough to be deliberate, delete
 * this one.
 */
export async function settleQuota(
  db: AnyDatabase,
  {
    userId,
    reservedBytes,
    actualBytes,
  }: { userId: string; reservedBytes: number; actualBytes: number },
): Promise<{ bytesUsed: number; bytesLimit: number; overQuota: boolean }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        bytesUsed: userMediaQuota.bytesUsed,
        bytesLimit: userMediaQuota.bytesLimit,
      })
      .from(userMediaQuota)
      .where(eq(userMediaQuota.userId, userId))
      .for("update");

    if (!row) throw new Error(`no quota row for ${userId}`);

    // Floored at zero for the same reason `releaseQuota` floors: a correction
    // larger than the running total would otherwise store a negative.
    const bytesUsed = Math.max(
      0,
      row.bytesUsed + (actualBytes - reservedBytes),
    );

    await tx
      .update(userMediaQuota)
      .set({ bytesUsed })
      .where(eq(userMediaQuota.userId, userId));

    return {
      bytesUsed,
      bytesLimit: row.bytesLimit,
      overQuota: bytesUsed > row.bytesLimit,
    };
  });
}
