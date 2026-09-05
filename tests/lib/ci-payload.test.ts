import { describe, expect, it } from "vitest";

import {
  ciNotifyPayloadSchema,
  isFresh,
  signBody,
  verifySignature,
  commitSubject,
  shortSha,
  SIGNATURE_WINDOW_SECONDS,
} from "@/lib/ci/payload";

/**
 * The signature is the only thing standing between this endpoint and anybody
 * on the internet who wants to buzz the maintainer's phone, so every way of
 * getting it wrong is asserted here rather than assumed.
 */

const SECRET = "a-ci-secret-that-is-long-enough";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    repository: "Mahmoud-walid/Chemlab",
    branch: "main",
    commitSha: "0".repeat(39) + "a",
    commitMessage: "fix(ci): something\n\nA body nobody needs in a tray.",
    actor: "Mahmoud-walid",
    job: "verify",
    outcome: "failure",
    failedJobs: ["verify"],
    runUrl: "https://github.com/Mahmoud-walid/Chemlab/actions/runs/1",
    timestamp: 1_800_000_000,
    nonce: "0123456789abcdef",
    ...overrides,
  };
}

describe("the signature", () => {
  it("accepts a body signed with the secret", () => {
    const body = JSON.stringify(payload());
    expect(verifySignature(body, signBody(body, SECRET), SECRET).ok).toBe(true);
  });

  it("refuses a body modified after signing", () => {
    // The reason this is an HMAC over the body rather than a bearer token: a
    // token authenticates the caller and says nothing about what they sent.
    const body = JSON.stringify(payload());
    const signature = signBody(body, SECRET);
    const tampered = JSON.stringify(payload({ branch: "attacker" }));

    expect(verifySignature(tampered, signature, SECRET)).toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("refuses the right body signed with the wrong secret", () => {
    const body = JSON.stringify(payload());
    expect(
      verifySignature(body, signBody(body, "not-the-secret"), SECRET).ok,
    ).toBe(false);
  });

  it("refuses a missing or malformed header without comparing anything", () => {
    const body = JSON.stringify(payload());
    expect(verifySignature(body, null, SECRET).reason).toBe(
      "missing-signature",
    );
    expect(verifySignature(body, "sha256=nope", SECRET).reason).toBe(
      "malformed-signature",
    );
    // A different algorithm prefix is not silently accepted as sha256.
    expect(verifySignature(body, `sha1=${"0".repeat(64)}`, SECRET).reason).toBe(
      "malformed-signature",
    );
  });

  it("does not throw on a length mismatch", () => {
    // `timingSafeEqual` throws when the buffers differ in length. Reaching it
    // with an unchecked length turns a bad request into a 500, which tells an
    // attacker they found something.
    const body = JSON.stringify(payload());
    expect(() => verifySignature(body, "sha256=abc", SECRET)).not.toThrow();
  });
});

describe("freshness", () => {
  const now = new Date(1_800_000_000_000);

  it("accepts a request inside the window, in either direction", () => {
    // A runner's clock can be ahead as easily as behind, and refusing the
    // future would be a mystery to whoever hit it.
    expect(isFresh(1_800_000_000, now)).toBe(true);
    expect(isFresh(1_800_000_000 - SIGNATURE_WINDOW_SECONDS + 1, now)).toBe(
      true,
    );
    expect(isFresh(1_800_000_000 + SIGNATURE_WINDOW_SECONDS - 1, now)).toBe(
      true,
    );
  });

  it("refuses a captured request replayed later", () => {
    expect(isFresh(1_800_000_000 - SIGNATURE_WINDOW_SECONDS - 1, now)).toBe(
      false,
    );
  });
});

describe("the payload", () => {
  it("accepts what the workflow sends", () => {
    expect(ciNotifyPayloadSchema.safeParse(payload()).success).toBe(true);
  });

  it("refuses an outcome that is not one of the three", () => {
    expect(
      ciNotifyPayloadSchema.safeParse(payload({ outcome: "flaky" })).success,
    ).toBe(false);
  });

  it("refuses a short sha", () => {
    // The short form is derived for display. Storing it would make
    // `ci_runs.commit_sha` ambiguous the first time two commits collide on
    // seven characters.
    expect(
      ciNotifyPayloadSchema.safeParse(payload({ commitSha: "abc1234" }))
        .success,
    ).toBe(false);
  });

  it("refuses a run URL that is not a URL", () => {
    // It becomes the notification's click target and a Slack button href.
    expect(
      ciNotifyPayloadSchema.safeParse(payload({ runUrl: "/actions/1" }))
        .success,
    ).toBe(false);
  });

  it("refuses a nonce too short to be random", () => {
    expect(
      ciNotifyPayloadSchema.safeParse(payload({ nonce: "abc" })).success,
    ).toBe(false);
  });
});

describe("what reaches a notification", () => {
  it("keeps the first line of the commit message", () => {
    // A commit body would fill the tray and is never the part that identifies
    // the commit.
    expect(commitSubject("fix: a thing\n\nWhy, at length.")).toBe(
      "fix: a thing",
    );
    expect(commitSubject("")).toBe("");
  });

  it("abbreviates the sha the way git does", () => {
    expect(shortSha("0123456789abcdef0123456789abcdef01234567")).toBe(
      "0123456",
    );
  });
});
