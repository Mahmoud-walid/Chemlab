import { describe, expect, it } from "vitest";

import { subscriptionSchema } from "@/lib/push/subscription-schema";

/**
 * The browser's subscription, validated. These values are written to a table
 * and then used to build outbound HTTPS requests, so "the browser sent it" is
 * not a reason to trust them.
 */

const VALID = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  keys: {
    p256dh: "B".repeat(87),
    auth: "C".repeat(22),
  },
};

describe("subscriptionSchema", () => {
  it("accepts what a browser actually sends", () => {
    expect(subscriptionSchema.safeParse(VALID).success).toBe(true);
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "file:///etc/passwd",
    "not a url",
    "",
  ])("refuses %s as an endpoint", (endpoint) => {
    // The endpoint becomes an outbound request. Anything but https is either a
    // broken client or an attempt to make the server fetch something.
    expect(subscriptionSchema.safeParse({ ...VALID, endpoint }).success).toBe(
      false,
    );
  });

  it("refuses a truncated key", () => {
    // A short p256dh fails at ENCRYPTION time, inside the send, far from the
    // request that stored it.
    expect(
      subscriptionSchema.safeParse({
        ...VALID,
        keys: { ...VALID.keys, p256dh: "B".repeat(10) },
      }).success,
    ).toBe(false);
  });

  it("refuses a key that is not base64url", () => {
    expect(
      subscriptionSchema.safeParse({
        ...VALID,
        keys: { ...VALID.keys, auth: "!".repeat(22) },
      }).success,
    ).toBe(false);
  });

  it("refuses a body with no keys at all", () => {
    expect(
      subscriptionSchema.safeParse({ endpoint: VALID.endpoint }).success,
    ).toBe(false);
  });
});
