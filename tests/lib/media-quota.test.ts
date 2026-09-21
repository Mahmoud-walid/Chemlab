import { describe, expect, it } from "vitest";

import {
  MEDIA_QUOTA_BYTES,
  checkQuota,
  defaultQuotaBytes,
} from "@/lib/media/quota";
import { MEDIA_CONSTRAINTS } from "@/lib/media/constraints";

/**
 * The quota policy from Q43.
 *
 * Two things are worth proving here, and only one of them is arithmetic. The
 * first is the boundary: a quota that admits the file which takes an account
 * past its limit is a suggestion, and the off-by-one is the whole of it.
 *
 * The second is that the numbers still make sense against the per-file caps
 * they were chosen from. The caps live in `constraints.ts` and the quotas
 * here, so nothing stops somebody raising the avatar cap to 20 MB and leaving
 * a member quota that no longer admits a single avatar. The relationships are
 * asserted rather than the numbers restated — asserting `member === 10 * MB`
 * would only prove the constant was copied twice.
 */

const MB = 1024 * 1024;

const avatarCap = MEDIA_CONSTRAINTS.avatars[0]!.maxBytes;
const lessonImageCap = MEDIA_CONSTRAINTS.lessons.find((rule) =>
  rule.mimeTypes.includes("image/jpeg"),
)!.maxBytes;

describe("defaultQuotaBytes", () => {
  it("gives an author the author allowance", () => {
    expect(defaultQuotaBytes(true)).toBe(MEDIA_QUOTA_BYTES.author);
  });

  it("gives everybody else the member allowance", () => {
    expect(defaultQuotaBytes(false)).toBe(MEDIA_QUOTA_BYTES.member);
  });

  it("does not hand a member the author allowance", () => {
    // The failure worth naming: a default that collapses to one number is a
    // gigabyte handed to anybody who can complete a sign-up form.
    expect(defaultQuotaBytes(false)).toBeLessThan(MEDIA_QUOTA_BYTES.author);
  });
});

describe("the quotas against the per-file caps they were chosen from", () => {
  it("lets a member replace an avatar rather than refusing the second one", () => {
    // Replacing a picture writes the new file before the old is reclaimed, so
    // a quota of exactly one avatar refuses the first change and reads as a
    // bug. Two is the minimum that is not broken; the chosen value is five.
    expect(MEDIA_QUOTA_BYTES.member).toBeGreaterThanOrEqual(avatarCap * 2);
  });

  it("keeps the member allowance to avatars rather than a storage locker", () => {
    // Not phrased as "a member cannot store a lesson image": what prevents
    // that is the `permission` on the constraint, not the quota, and asserting
    // it here would put the control in the wrong place. What this guards is
    // the number drifting upward until a free sign-up is worth farming.
    expect(MEDIA_QUOTA_BYTES.member).toBeLessThanOrEqual(avatarCap * 10);
  });

  it("gives an author room for an illustrated course, not just a lesson", () => {
    // Ten lessons at five images each, at the full per-image cap. The point of
    // the author number is that nobody plans around it.
    expect(MEDIA_QUOTA_BYTES.author).toBeGreaterThan(lessonImageCap * 50);
  });
});

describe("checkQuota", () => {
  it("admits a file that fits", () => {
    expect(
      checkQuota({ bytesUsed: 0, bytesLimit: 10 * MB, bytes: MB }),
    ).toEqual({ refusals: [], bytesRemaining: 9 * MB });
  });

  it("admits a file that fits exactly", () => {
    // Exactly at the limit is within it. Refusing here would make the limit
    // one byte smaller than it says.
    expect(
      checkQuota({ bytesUsed: 9 * MB, bytesLimit: 10 * MB, bytes: MB }),
    ).toEqual({ refusals: [], bytesRemaining: 0 });
  });

  it("refuses the file that would take the account one byte past its limit", () => {
    // The assertion this file exists for.
    const verdict = checkQuota({
      bytesUsed: 9 * MB,
      bytesLimit: 10 * MB,
      bytes: MB + 1,
    });
    expect(verdict.refusals).toEqual(["over-quota"]);
  });

  it("judges the total after the upload, not the usage before it", () => {
    // An account one byte under its limit has room for one byte, not for a
    // 200 MB video. Checking `bytesUsed < bytesLimit` would admit this.
    const limit = MEDIA_QUOTA_BYTES.author;
    const verdict = checkQuota({
      bytesUsed: limit - 1,
      bytesLimit: limit,
      bytes: 200 * MB,
    });
    expect(verdict.refusals).toEqual(["over-quota"]);
  });

  it("refuses an account already over its limit rather than grandfathering it", () => {
    // Reachable two ways: an operator lowers a limit, or Cloudinary reports a
    // real size larger than the client claimed.
    const verdict = checkQuota({
      bytesUsed: 12 * MB,
      bytesLimit: 10 * MB,
      bytes: 1,
    });
    expect(verdict.refusals).toEqual(["over-quota"]);
  });

  it("floors the remaining allowance at zero rather than going negative", () => {
    // A negative allowance has no honest rendering: "-2 MB left" is not a
    // sentence to put in front of somebody.
    expect(
      checkQuota({ bytesUsed: 12 * MB, bytesLimit: 10 * MB, bytes: 1 })
        .bytesRemaining,
    ).toBe(0);
  });

  it("reports what is left so the uploader can be told a number", () => {
    // "No space" and "84 MB left of 2 GB" are different sentences, and only
    // one of them tells somebody what to delete.
    expect(
      checkQuota({ bytesUsed: 40 * MB, bytesLimit: 100 * MB, bytes: 10 * MB })
        .bytesRemaining,
    ).toBe(50 * MB);
  });

  it("admits a full-size lesson image into a fresh author allowance", () => {
    // The end-to-end sanity check on the chosen numbers: the common case must
    // not be the refused one.
    expect(
      checkQuota({
        bytesUsed: 0,
        bytesLimit: defaultQuotaBytes(true),
        bytes: lessonImageCap,
      }).refusals,
    ).toEqual([]);
  });

  it("admits a full-size avatar into a fresh member allowance", () => {
    expect(
      checkQuota({
        bytesUsed: 0,
        bytesLimit: defaultQuotaBytes(false),
        bytes: avatarCap,
      }).refusals,
    ).toEqual([]);
  });
});
