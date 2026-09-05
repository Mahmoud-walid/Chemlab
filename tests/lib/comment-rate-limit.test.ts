import { describe, expect, it } from "vitest";

import {
  BURST,
  HOURLY_LIMIT,
  MIN_INTERVAL_MS,
  decidePost,
  retryAfterSeconds,
} from "@/lib/comments/rate-limit";

/**
 * The limiter is the whole spam control, since #25 ships with no account-age
 * gate and no verified-email requirement. Every boundary is asserted, because
 * a limiter that is slightly too loose is not a limiter.
 */

const now = new Date("2026-03-10T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

/** `n` comments, one every `spacing` ms, newest first — the order the query
 * returns them in. */
function history(n: number, spacing: number, body = "unique") {
  return Array.from({ length: n }, (_, i) => ({
    createdAt: ago(i * spacing),
    body: `${body}-${i}`,
  }));
}

describe("the first comment", () => {
  it("is always allowed", () => {
    expect(decidePost([], "hello", now)).toEqual({
      allowed: true,
      retryAfterMs: 0,
    });
  });
});

describe("pace", () => {
  it("allows a burst of answers in a row", () => {
    // Somebody answering three questions quickly is not an attack, and a flat
    // 15-second gate would treat them as one.
    expect(decidePost(history(BURST - 1, 1_000), "new", now).allowed).toBe(
      true,
    );
  });

  it("refuses the one after the burst, and says how long to wait", () => {
    const decision = decidePost(history(BURST, 1_000), "new", now);

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("too-fast");
    expect(decision.retryAfterMs).toBeGreaterThan(0);
    expect(decision.retryAfterMs).toBeLessThanOrEqual(MIN_INTERVAL_MS);
    // Rounded UP: telling a client to retry while it is still refused is worse
    // than telling it to wait a moment longer.
    expect(retryAfterSeconds(decision)).toBe(
      Math.ceil(decision.retryAfterMs / 1000),
    );
  });

  it("allows again once the interval has passed", () => {
    const recent = history(BURST, MIN_INTERVAL_MS + 1_000);
    expect(decidePost(recent, "new", now).allowed).toBe(true);
  });
});

describe("the hourly limit", () => {
  it("is what actually bounds a patient script", () => {
    // The interval and the burst are both satisfied by waiting. This is not.
    const recent = history(HOURLY_LIMIT, 60_000);
    const decision = decidePost(recent, "new", now);

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("hourly-limit");
  });

  it("slides, so an hour-old run does not cost an hour of silence", () => {
    // Ten comments, all more than an hour ago: the window has moved past them.
    const recent = history(HOURLY_LIMIT, 60_000).map((comment) => ({
      ...comment,
      createdAt: ago(comment.createdAt.getTime() ? 2 * 60 * 60 * 1000 : 0),
    }));

    expect(decidePost(recent, "new", now).allowed).toBe(true);
  });

  it("reports the wait as time until the OLDEST falls out", () => {
    const recent = history(HOURLY_LIMIT, 60_000);
    const decision = decidePost(recent, "new", now);

    // The oldest is 9 minutes back, so roughly 51 minutes remain.
    expect(decision.retryAfterMs).toBeGreaterThan(50 * 60 * 1000);
    expect(decision.retryAfterMs).toBeLessThan(60 * 60 * 1000);
  });
});

describe("duplicates", () => {
  it("refuses the same body twice within the hour", () => {
    // A double-submitted form and a copy-paste spam run look identical from
    // here, and neither should produce two rows.
    const recent = [{ createdAt: ago(60_000), body: "Great lesson!" }];
    const decision = decidePost(recent, "Great lesson!", now);

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("duplicate");
    // Nothing to wait for: the honest fix is different text, not patience.
    expect(decision.retryAfterMs).toBe(0);
  });

  it("allows the same body once the window has passed", () => {
    const recent = [
      { createdAt: ago(2 * 60 * 60 * 1000), body: "Great lesson!" },
    ];
    expect(decidePost(recent, "Great lesson!", now).allowed).toBe(true);
  });

  it("is checked before the pace limits, because the fix differs", () => {
    // A duplicate at speed should say "you already said that", not "wait".
    const recent = [
      { createdAt: ago(1_000), body: "same" },
      ...history(BURST, 1_000),
    ];
    expect(decidePost(recent, "same", now).reason).toBe("duplicate");
  });
});
