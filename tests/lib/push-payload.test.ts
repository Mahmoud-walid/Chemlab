import { describe, expect, it } from "vitest";

import {
  BODY_MAX,
  isWithinSizeLimit,
  parsePayload,
  payloadBytes,
  safeNotificationUrl,
  TITLE_MAX,
} from "@/lib/push/payload";

/**
 * The payload contract, which two other issues will both write against. What
 * is being pinned here is the shape and the two limits that only fail far from
 * the code that broke them: the size a push service accepts, and where a
 * notification is allowed to send the person who taps it.
 */

const MINIMAL = { title: "A reply", body: "Sara replied to your comment." };

describe("parsePayload", () => {
  it("fills in the defaults a sender should not have to repeat", () => {
    const payload = parsePayload(MINIMAL);
    expect(payload.url).toBe("/");
    expect(payload.icon).toContain("/icons/");
    expect(payload.renotify).toBe(false);
    expect(payload.data).toEqual({});
  });

  it("refuses an empty title or body", () => {
    // A notification with no text is a buzz with no explanation.
    expect(() => parsePayload({ ...MINIMAL, title: "" })).toThrow();
    expect(() => parsePayload({ ...MINIMAL, body: "" })).toThrow();
  });

  it("refuses text longer than a tray will show", () => {
    expect(() =>
      parsePayload({ ...MINIMAL, title: "x".repeat(TITLE_MAX + 1) }),
    ).toThrow();
    expect(() =>
      parsePayload({ ...MINIMAL, body: "x".repeat(BODY_MAX + 1) }),
    ).toThrow();
  });
});

describe("size", () => {
  it("accepts an ordinary notification", () => {
    expect(isWithinSizeLimit(parsePayload(MINIMAL))).toBe(true);
  });

  it("rejects one carrying a document in its data", () => {
    // The failure this prevents: a 413 from the push service, which arrives
    // long after the code that built the payload has returned.
    const fat = parsePayload({
      ...MINIMAL,
      data: { body: "x".repeat(5000) },
    });
    expect(payloadBytes(fat)).toBeGreaterThan(3000);
    expect(isWithinSizeLimit(fat)).toBe(false);
  });
});

describe("safeNotificationUrl", () => {
  const origin = "https://chemlab.test";

  it("keeps a path", () => {
    expect(safeNotificationUrl("/lessons/acids", origin)).toBe(
      "/lessons/acids",
    );
  });

  it("keeps the query and the fragment, which carry the comment anchor", () => {
    expect(safeNotificationUrl("/lessons/a?x=1#comment-2", origin)).toBe(
      "/lessons/a?x=1#comment-2",
    );
  });

  it("reduces an absolute URL on our own origin to its path", () => {
    expect(safeNotificationUrl(`${origin}/lessons/a`, origin)).toBe(
      "/lessons/a",
    );
  });

  it.each([
    "https://example.test/phish",
    "http://chemlab.test.evil/",
    "javascript:alert(1)",
  ])("refuses %s and sends the reader home instead", (url) => {
    // A notification looks like it came from the site. A payload that could
    // open any URL hands whoever can enqueue one a phishing primitive.
    expect(safeNotificationUrl(url, origin)).toBe(`${origin}/`);
  });

  it("falls back to the root for something unparseable", () => {
    expect(safeNotificationUrl("", origin)).toBe("/");
  });
});
