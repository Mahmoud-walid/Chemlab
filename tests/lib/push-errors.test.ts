import { describe, expect, it } from "vitest";

import {
  backoffSeconds,
  classify,
  MAX_ATTEMPTS,
  MAX_SUBSCRIPTION_FAILURES,
} from "@/lib/push/errors";

/**
 * What each push-service response means.
 *
 * These rules decide whether a device stays in the table. Getting 410 wrong in
 * either direction is the expensive mistake: retrying it forever fills the
 * table with ghosts, and treating a 500 as gone unsubscribes a user who did
 * nothing.
 */

describe("classify", () => {
  it.each([404, 410])("treats %i as gone, permanently", (statusCode) => {
    expect(classify({ statusCode })).toEqual({ kind: "expired" });
  });

  it("retries a 429, honouring Retry-After", () => {
    expect(
      classify({ statusCode: 429, headers: { "retry-after": "120" } }),
    ).toEqual({ kind: "retry", afterSeconds: 120 });
  });

  it("retries a 429 with no Retry-After, using a default", () => {
    const outcome = classify({ statusCode: 429 });
    expect(outcome.kind).toBe("retry");
  });

  it("reads an HTTP-date Retry-After rather than parsing it as zero", () => {
    const when = new Date(Date.now() + 90_000).toUTCString();
    const outcome = classify({
      statusCode: 503,
      headers: { "retry-after": when },
    });
    expect(outcome.kind).toBe("retry");
    if (outcome.kind === "retry") {
      expect(outcome.afterSeconds).toBeGreaterThan(60);
    }
  });

  it("does not retry a payload that is too large", () => {
    // Retrying sends the same oversized payload to the same service. This is
    // a bug in the sender, not a transient failure.
    expect(classify({ statusCode: 413 })).toMatchObject({ kind: "failed" });
  });

  it.each([400, 401, 403])(
    "does not retry %i, which means our VAPID setup is wrong",
    (statusCode) => {
      expect(classify({ statusCode })).toMatchObject({ kind: "failed" });
    },
  );

  it("retries a 500", () => {
    expect(classify({ statusCode: 500 }).kind).toBe("retry");
  });

  it("retries a request that never got a status at all", () => {
    // A network failure: the request may never have reached the service, so
    // the notification may never have been sent.
    expect(classify({}).kind).toBe("retry");
  });
});

describe("backoffSeconds", () => {
  it("grows with each attempt", () => {
    expect(backoffSeconds(1)).toBeLessThan(backoffSeconds(3));
  });

  it("is capped at an hour", () => {
    // A push nobody received in an hour is not more useful for arriving in two.
    expect(backoffSeconds(50)).toBe(3600);
  });
});

describe("the limits", () => {
  it("gives up on a delivery before it gives up on a device", () => {
    // They count different things: a delivery that failed five times may have
    // hit one bad moment; a device that has failed twenty times across days
    // is not coming back.
    expect(MAX_SUBSCRIPTION_FAILURES).toBeGreaterThan(MAX_ATTEMPTS);
  });
});
