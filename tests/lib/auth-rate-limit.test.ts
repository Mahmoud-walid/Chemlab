import { describe, expect, it } from "vitest";

import {
  decide,
  hashIdentifier,
  MAX_ATTEMPTS,
  withinWindow,
  WINDOW_MS,
} from "@/lib/auth-rate-limit";

describe("hashIdentifier", () => {
  it("is stable and case-insensitive, so one address is one key", () => {
    expect(hashIdentifier("Ada@Example.com ")).toBe(
      hashIdentifier("ada@example.com"),
    );
  });

  it("does not keep the value it was given", () => {
    const hash = hashIdentifier("ada@example.com");
    // The table this feeds must not become a list of everyone who has tried to
    // sign in — a dump of it should leak no addresses.
    expect(hash).not.toContain("ada");
    expect(hash).not.toContain("example");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("separates different identifiers", () => {
    expect(hashIdentifier("ada@example.com")).not.toBe(
      hashIdentifier("grace@example.com"),
    );
  });
});

describe("decide", () => {
  it("allows attempts below the threshold", () => {
    for (let failures = 0; failures < MAX_ATTEMPTS; failures++) {
      expect(decide(failures), `${failures} failures`).toEqual({
        allowed: true,
        retryAfterMs: 0,
      });
    }
  });

  it("locks out at the threshold", () => {
    const verdict = decide(MAX_ATTEMPTS);
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterMs).toBeGreaterThan(0);
  });

  it("backs off exponentially with each further failure", () => {
    const first = decide(MAX_ATTEMPTS).retryAfterMs;
    const second = decide(MAX_ATTEMPTS + 1).retryAfterMs;
    const third = decide(MAX_ATTEMPTS + 2).retryAfterMs;
    expect(second).toBe(first * 2);
    expect(third).toBe(first * 4);
  });

  it("caps the lockout, so an attacker cannot freeze an account forever", () => {
    // Someone who knows a victim's address could otherwise keep them locked
    // out permanently by failing on purpose.
    const huge = decide(MAX_ATTEMPTS + 40).retryAfterMs;
    expect(huge).toBeLessThanOrEqual(60 * 60 * 1000);
    expect(huge).toBe(decide(MAX_ATTEMPTS + 100).retryAfterMs);
  });
});

describe("withinWindow", () => {
  const now = new Date("2026-09-04T12:00:00Z");

  it("counts a recent attempt", () => {
    expect(withinWindow(new Date(now.getTime() - 1000), now)).toBe(true);
  });

  it("forgets one older than the window", () => {
    expect(withinWindow(new Date(now.getTime() - WINDOW_MS - 1), now)).toBe(
      false,
    );
  });
});
