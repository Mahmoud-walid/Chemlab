const MB = 1024 * 1024;
const GB = 1024 * MB;

/**
 * How much an account may store, and whether one more file fits.
 *
 * Kept apart from `constraints.ts` because the two answer different questions
 * and fail at different times. A constraint refuses THIS file — wrong type,
 * too big, too long — and it can be checked before a byte is uploaded. A quota
 * refuses this file because of every file before it, which means it needs the
 * running total and cannot be decided from the request alone.
 *
 * Pure, and taking the usage as an argument rather than reading it: the sign
 * endpoint that will call this is blocked on the Cloudinary account (Q3), and
 * the policy is worth settling and testing before the plumbing exists. What is
 * not here on purpose is the reading and the incrementing of `bytes_used` —
 * those are a transaction against `user_media_quota`, and a race there is a
 * quota that can be overrun by two uploads that check at the same moment.
 */

/**
 * Two numbers, not one — Q43, answered 2026-09-21.
 *
 * The two populations upload nothing like each other. An author illustrating
 * ten lessons at five images each is in the low hundreds of megabytes before
 * anybody calls it excessive; a normal account's only upload is its own
 * avatar, capped at 2 MB by `MEDIA_CONSTRAINTS`.
 *
 * One number for both cannot serve either. Small enough for a reader is an
 * author blocked in the middle of a lesson; generous enough for an author is a
 * gigabyte per sign-up, handed to anybody who can complete a form.
 */
export const MEDIA_QUOTA_BYTES = {
  /**
   * 2 GB. Roughly 200 illustrated lessons at the 10 MB-per-image cap, or ten
   * videos at the 200 MB cap — far enough from the working range that an
   * author never plans around it, close enough that a runaway upload script
   * stops somewhere.
   */
  author: 2 * GB,
  /**
   * 10 MB — five avatars' worth at the 2 MB cap.
   *
   * Deliberately not tight to a single avatar. Replacing a picture writes the
   * new file before the old one is reclaimed, so a limit of exactly one avatar
   * would refuse the second change and read as a bug. Five is room to change
   * your mind without being room to store anything else.
   */
  member: 10 * MB,
} as const;

/**
 * The limit for an account with no row of its own.
 *
 * `user_media_quota.bytes_limit` is NOT NULL with no database default, which
 * is deliberate: a row exists when somebody has been given a specific
 * allowance, and its absence means the platform default applies rather than
 * meaning zero. A default in the schema would have been a policy set by
 * whichever number was typed first, and invisible afterwards.
 *
 * Keyed off `media:create` — the permission that marks somebody as writing the
 * content images go into — rather than off a role name. Roles are data here
 * and a deployment may define its own; a permission is the thing the rest of
 * the authorisation layer already reasons about.
 */
export function defaultQuotaBytes(holdsMediaCreate: boolean): number {
  return holdsMediaCreate ? MEDIA_QUOTA_BYTES.author : MEDIA_QUOTA_BYTES.member;
}

export type QuotaRefusal = "over-quota";

export interface QuotaCheck {
  /** What the account has stored already, from `user_media_quota.bytes_used`. */
  bytesUsed: number;
  /** Its limit: the row's `bytes_limit`, or `defaultQuotaBytes()`. */
  bytesLimit: number;
  /** The size of the file being asked about. */
  bytes: number;
}

export interface QuotaVerdict {
  refusals: QuotaRefusal[];
  /** What is left after this upload, floored at zero. Shown to the uploader,
   * so it is a number rather than a boolean: "no space" and "84 MB left of
   * 2 GB" are different sentences. */
  bytesRemaining: number;
}

/**
 * Whether one more file fits.
 *
 * The comparison is on the total AFTER the upload, not before. Checking
 * `bytesUsed < bytesLimit` would admit a 200 MB video into an account one byte
 * under its limit, which is how a quota becomes a suggestion.
 *
 * An account already over its limit — reduced by an operator, or grown by a
 * file whose real size only Cloudinary knew — is refused rather than
 * grandfathered, and `bytesRemaining` floors at zero rather than going
 * negative, because a negative allowance has no honest rendering.
 */
export function checkQuota({
  bytesUsed,
  bytesLimit,
  bytes,
}: QuotaCheck): QuotaVerdict {
  const after = bytesUsed + bytes;
  return {
    refusals: after > bytesLimit ? ["over-quota"] : [],
    bytesRemaining: Math.max(0, bytesLimit - after),
  };
}
