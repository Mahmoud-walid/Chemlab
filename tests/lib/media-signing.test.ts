import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import {
  SIGNATURE_TTL_SECONDS,
  signatureIsFresh,
  signaturePayload,
  signParams,
  verifySignature,
} from "@/lib/media/signing";

/**
 * The signature is the whole security model of a direct browser upload.
 *
 * Nothing else stands between an authenticated author and writing anywhere in
 * the media account: the file never touches this server, so "the client was
 * asked to upload into this folder" is not a control. What is a control is
 * that no other folder was ever signed.
 *
 * So these tests are about the two things that would quietly break that: a
 * payload that does not match Cloudinary's documented rule (every upload
 * fails, visibly), and a payload that a client can influence (nothing fails,
 * and that is the problem).
 */

const SECRET = "test-secret-not-a-real-one";

describe("the string that gets hashed", () => {
  it("sorts by name and joins with &, as Cloudinary documents", () => {
    expect(
      signaturePayload({
        timestamp: 1699999999,
        folder: "chemlab/dev/lessons",
      }),
    ).toBe("folder=chemlab/dev/lessons&timestamp=1699999999");
  });

  it("is independent of the order the caller wrote the object in", () => {
    // Object key order is a property of how the call site was typed. A
    // signature that depended on it would work until somebody reformatted.
    const a = signaturePayload({ b: 2, a: 1, c: 3 });
    const b = signaturePayload({ c: 3, a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it.each(["file", "api_key", "resource_type", "cloud_name", "signature"])(
    "never signs %s",
    (name) => {
      // Cloudinary's own exclusion list: these travel in the URL or the
      // multipart body rather than the signed set. Signing one makes every
      // upload fail with an error that says nothing about why.
      expect(signaturePayload({ timestamp: 1, [name]: "x" })).toBe(
        "timestamp=1",
      );
    },
  );

  it("drops empty, null and undefined values", () => {
    // Cloudinary drops them from the request too, so signing them is a hash
    // of a request nobody sent.
    expect(
      signaturePayload({
        timestamp: 1,
        folder: "",
        alt: null,
        tag: undefined,
      }),
    ).toBe("timestamp=1");
  });

  it("keeps a false and a zero, which are values", () => {
    // The bug this would be: `if (!value) skip`, which throws away exactly the
    // parameters whose whole meaning is "off" and "none".
    expect(signaturePayload({ a: false, b: 0 })).toBe("a=false&b=0");
  });
});

describe("the signature itself", () => {
  it("is SHA-1 of the payload with the secret appended", () => {
    // Asserted against the construction rather than a recorded digest: a
    // hard-coded hex string proves this implementation has not changed, which
    // is not the same as proving it is right.
    const params = { folder: "chemlab/dev/lessons", timestamp: 1699999999 };
    const expected = createHash("sha1")
      .update(`${signaturePayload(params)}${SECRET}`)
      .digest("hex");

    expect(signParams(params, SECRET)).toBe(expected);
  });

  it("changes when any signed parameter changes", () => {
    // The property the folder guarantee rests on. A client that rewrites the
    // folder rewrites the hash, and Cloudinary refuses it.
    const signed = signParams(
      { folder: "chemlab/production/lessons", timestamp: 1 },
      SECRET,
    );
    const tampered = signParams(
      { folder: "chemlab/production/avatars", timestamp: 1 },
      SECRET,
    );
    expect(tampered).not.toBe(signed);
  });

  it("changes with the secret", () => {
    const params = { timestamp: 1 };
    expect(signParams(params, SECRET)).not.toBe(signParams(params, "other"));
  });
});

describe("verifying what Cloudinary sends back", () => {
  it("accepts its own signature", () => {
    const params = {
      public_id: "chemlab/dev/lessons/2026/09/x/abc",
      version: 1,
    };
    expect(verifySignature(params, signParams(params, SECRET), SECRET)).toBe(
      true,
    );
  });

  it("rejects a payload modified after signing", () => {
    // The confirm step believes Cloudinary about bytes and dimensions. Without
    // this, "the upload finished, it is a 2 KB image" is a sentence anybody
    // can POST.
    const signature = signParams({ bytes: 100 }, SECRET);
    expect(verifySignature({ bytes: 999_999 }, signature, SECRET)).toBe(false);
  });

  it("rejects a signature of the wrong length without throwing", () => {
    // `timingSafeEqual` throws on a length mismatch, so a short signature
    // would be a 500 rather than a refusal — and a 500 is a different answer
    // from a 401, which is itself information.
    expect(verifySignature({ bytes: 1 }, "abc", SECRET)).toBe(false);
    expect(verifySignature({ bytes: 1 }, "", SECRET)).toBe(false);
  });
});

describe("freshness", () => {
  const NOW = 1_700_000_000;

  it("accepts a signature minted now", () => {
    expect(signatureIsFresh(NOW, NOW)).toBe(true);
  });

  it("accepts one just inside the window", () => {
    expect(signatureIsFresh(NOW - SIGNATURE_TTL_SECONDS + 1, NOW)).toBe(true);
  });

  it("rejects one just outside it", () => {
    expect(signatureIsFresh(NOW - SIGNATURE_TTL_SECONDS - 1, NOW)).toBe(false);
  });

  it("tolerates a minute of clock skew but not more", () => {
    // A few seconds ahead is two machines disagreeing. Minutes ahead is
    // somebody choosing the number, and accepting it extends the window by
    // however far ahead they set it.
    expect(signatureIsFresh(NOW + 30, NOW)).toBe(true);
    expect(signatureIsFresh(NOW + 3600, NOW)).toBe(false);
  });

  it("is much shorter than Cloudinary's own hour", () => {
    // A signature is a bearer authorisation to write into our account. The
    // legitimate gap between asking and uploading is seconds; an hour is
    // fifty extra minutes in which a captured one still works.
    expect(SIGNATURE_TTL_SECONDS).toBeLessThanOrEqual(600);
  });
});
