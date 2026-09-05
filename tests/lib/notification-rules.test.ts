import { describe, expect, it } from "vitest";

import {
  BROADCAST_COOLDOWN_MS,
  DEFAULT_PREFERENCES,
  broadcastAllowed,
  decidePush,
  isSelfAction,
  localMinutes,
  pushTag,
  quietHoursEnd,
  shouldRecord,
  type Preferences,
} from "@/lib/notifications/rules";
import {
  NOTIFICATION_TYPES,
  broadcastTypes,
  personalTypes,
  specFor,
} from "@/lib/notifications/types";

/**
 * The anti-annoyance rules. #21 asks for these to be implemented rather than
 * documented, and each one is a rule that reads as obvious in prose and is
 * quietly missing in most notification systems.
 *
 * The distinction running through all of it: muting stops DELIVERY, never the
 * record. The bell is the source of truth; a push is an accelerator.
 */

const NOW = new Date("2026-09-05T12:00:00Z");

const prefs = (overrides: Partial<Preferences> = {}): Preferences => ({
  ...DEFAULT_PREFERENCES,
  ...overrides,
});

describe("never notify somebody about their own action", () => {
  it("recognises a self-action", () => {
    expect(isSelfAction("u1", "u1")).toBe(true);
    expect(isSelfAction("u1", "u2")).toBe(false);
  });

  it("treats an anonymous actor as somebody else", () => {
    // Null is "we do not know who", not "the recipient".
    expect(isSelfAction(null, "u1")).toBe(false);
  });

  it.each(NOTIFICATION_TYPES)("writes no row for %s on yourself", (type) => {
    // The single most common embarrassment in notification systems, checked
    // for every type rather than the one somebody remembered.
    expect(shouldRecord(type, "u1", "u1")).toBe(false);
    expect(shouldRecord(type, "u2", "u1")).toBe(true);
  });
});

describe("preferences gate the push, not the record", () => {
  it("still records when the category is muted", () => {
    // The row is what the bell shows. A muted category means "do not buzz me",
    // not "hide that this happened".
    expect(shouldRecord("comment.replied", "u2", "u1")).toBe(true);
    expect(
      decidePush(
        "comment.replied",
        prefs({ categories: { "comment.replied": false } }),
        NOW,
      ),
    ).toMatchObject({ send: false, reason: "category-muted" });
  });

  it("sends by default when nothing is configured", () => {
    // A user with no preference row must not silently receive nothing.
    for (const type of NOTIFICATION_TYPES) {
      expect(decidePush(type, DEFAULT_PREFERENCES, NOW).send).toBe(
        specFor(type).defaultOn,
      );
    }
  });

  it("respects the push master switch", () => {
    expect(
      decidePush("lesson.liked", prefs({ pushEnabled: false }), NOW),
    ).toMatchObject({ send: false, reason: "push-disabled" });
  });
});

describe("the global mute", () => {
  it("suppresses while it lasts", () => {
    const muted = prefs({ mutedUntil: new Date(NOW.getTime() + 60_000) });
    expect(decidePush("lesson.liked", muted, NOW)).toMatchObject({
      send: false,
      reason: "globally-muted",
    });
  });

  it("drops rather than defers", () => {
    // "Leave me alone" whose queue discharges the moment it lifts is the
    // opposite of leaving somebody alone.
    const muted = prefs({ mutedUntil: new Date(NOW.getTime() + 60_000) });
    expect(decidePush("lesson.liked", muted, NOW).deferUntil).toBeNull();
  });

  it("stops suppressing once it expires", () => {
    const expired = prefs({ mutedUntil: new Date(NOW.getTime() - 1) });
    expect(decidePush("lesson.liked", expired, NOW).send).toBe(true);
  });
});

describe("quiet hours", () => {
  const quiet = (overrides: Partial<Preferences> = {}) =>
    prefs({
      quietHoursStart: 22 * 60,
      quietHoursEnd: 7 * 60,
      timezone: "UTC",
      ...overrides,
    });

  it("defers rather than drops", () => {
    // A push suppressed at 3 a.m. and never sent is one the user did not get.
    const at3am = new Date("2026-09-05T03:00:00Z");
    const decision = decidePush("lesson.liked", quiet(), at3am);

    expect(decision).toMatchObject({ send: false, reason: "quiet-hours" });
    expect(decision.deferUntil).toEqual(new Date("2026-09-05T07:00:00Z"));
  });

  it("handles a window that crosses midnight", () => {
    // 22:00–07:00 is the normal case, and the one a naive `start <= x < end`
    // gets exactly backwards.
    const at23 = new Date("2026-09-05T23:30:00Z");
    expect(quietHoursEnd(quiet(), at23)).toEqual(
      new Date("2026-09-06T07:00:00Z"),
    );
  });

  it("sends outside the window", () => {
    const noon = new Date("2026-09-05T12:00:00Z");
    expect(decidePush("lesson.liked", quiet(), noon).send).toBe(true);
  });

  it("is computed in the USER's timezone, not the server's", () => {
    // 03:00 UTC is 06:00 in Cairo — still quiet — and 22:00 the previous day
    // in Los Angeles, which is also quiet but for a different reason. The
    // failure this guards against wakes people in every zone but one, and
    // looks correct to whoever wrote the test in that zone.
    const at3amUtc = new Date("2026-09-05T03:00:00Z");

    const cairo = quiet({ timezone: "Africa/Cairo" });
    expect(decidePush("lesson.liked", cairo, at3amUtc).send).toBe(false);

    // 15:00 UTC is 17:00 in Cairo: awake.
    const at3pmUtc = new Date("2026-09-05T15:00:00Z");
    expect(decidePush("lesson.liked", cairo, at3pmUtc).send).toBe(true);
    // …and 08:00 in Los Angeles: also awake.
    const la = quiet({ timezone: "America/Los_Angeles" });
    expect(decidePush("lesson.liked", la, at3pmUtc).send).toBe(true);
  });

  it("ignores an empty window rather than silencing everything", () => {
    // One mis-set field should not mute a user for ever.
    const same = quiet({ quietHoursStart: 480, quietHoursEnd: 480 });
    expect(quietHoursEnd(same, NOW)).toBeNull();
  });

  it("does nothing when quiet hours are unset", () => {
    expect(quietHoursEnd(DEFAULT_PREFERENCES, NOW)).toBeNull();
  });

  it("falls back to UTC for an unknown timezone", () => {
    // Throwing here would silence a user's notifications for ever once the
    // error was swallowed upstream.
    expect(localMinutes(NOW, "Not/AZone")).toBe(12 * 60);
  });
});

describe("pushTag", () => {
  it("collapses a tray entry with its aggregated row", () => {
    // Or the tray shows "1 person liked" beside "5 people liked" for the same
    // comment.
    expect(pushTag("comment.liked", "c1")).toBe(pushTag("comment.liked", "c1"));
    expect(pushTag("comment.liked", "c1")).not.toBe(
      pushTag("comment.liked", "c2"),
    );
  });
});

describe("broadcast rate limiting", () => {
  it("allows the first broadcast", () => {
    expect(broadcastAllowed(null, NOW)).toBe(true);
  });

  it("refuses a second one inside the cooldown", () => {
    // Publishing ten lessons in a batch import must not send ten broadcasts to
    // every user on the platform — the fastest way to have a category muted
    // for ever.
    const recent = new Date(NOW.getTime() - 60_000);
    expect(broadcastAllowed(recent, NOW)).toBe(false);
  });

  it("allows one after the cooldown", () => {
    const old = new Date(NOW.getTime() - BROADCAST_COOLDOWN_MS - 1);
    expect(broadcastAllowed(old, NOW)).toBe(true);
  });
});

describe("the catalogue", () => {
  it("splits into personal and broadcast with nothing left over", () => {
    expect([...personalTypes(), ...broadcastTypes()].sort()).toEqual(
      [...NOTIFICATION_TYPES].sort(),
    );
  });

  it("aggregates likes but not replies", () => {
    // Two replies are two things to read; collapsing them hides one behind a
    // count. Five likes are one fact.
    expect(specFor("comment.liked").aggregates).toBe(true);
    expect(specFor("lesson.liked").aggregates).toBe(true);
    expect(specFor("comment.replied").aggregates).toBe(false);
  });
});
