import { describe, expect, it } from "vitest";

import {
  isValidTimezone,
  mergeCategories,
  preferencesPatchSchema,
  toUpdate,
} from "@/lib/notifications/preferences-input";
import { DEFAULT_PREFERENCES } from "@/lib/notifications/rules";

describe("the preferences patch", () => {
  it("accepts one switch on its own", () => {
    const parsed = preferencesPatchSchema.safeParse({
      categories: { "lesson.liked": false },
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses a category the catalogue does not have", () => {
    // Dropping it silently would look exactly like a switch that did nothing.
    const parsed = preferencesPatchSchema.safeParse({
      categories: { "lesson.exploded": false },
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses a field nobody may set from a settings form", () => {
    const parsed = preferencesPatchSchema.safeParse({ userId: "someone-else" });
    expect(parsed.success).toBe(false);
  });

  it("refuses a minute that is not a time of day", () => {
    // 1440 is midnight tomorrow, not a minute of this day, and a quiet window
    // ending there never ends.
    expect(
      preferencesPatchSchema.safeParse({
        quietHoursStart: 1440,
        quietHoursEnd: 60,
      }).success,
    ).toBe(false);
    expect(
      preferencesPatchSchema.safeParse({
        quietHoursStart: 1320,
        quietHoursEnd: 420,
      }).success,
    ).toBe(true);
  });

  it("refuses half a quiet-hours window", () => {
    // Half-set reads as "quiet hours off" while the form still looks set —
    // the kind of disagreement nobody reports because it looks like their own
    // mistake.
    expect(
      preferencesPatchSchema.safeParse({ quietHoursStart: 1320 }).success,
    ).toBe(false);
    // Clearing one end IS allowed: it turns the window off.
    expect(
      preferencesPatchSchema.safeParse({ quietHoursStart: null }).success,
    ).toBe(true);
  });

  it("refuses a timezone ICU does not know", () => {
    // Quiet hours are evaluated in it, so an unrecognised zone silences
    // somebody at the wrong hours and nothing surfaces it.
    expect(isValidTimezone("Africa/Cairo")).toBe(true);
    expect(isValidTimezone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
    expect(
      preferencesPatchSchema.safeParse({ timezone: "Mars/Olympus_Mons" })
        .success,
    ).toBe(false);
  });
});

describe("applying a patch", () => {
  it("merges categories rather than replacing them", () => {
    // Two tabs open on the settings page: the later save must not undo the
    // earlier one's unrelated switch.
    const merged = mergeCategories(
      { "lesson.liked": false, "comment.replied": false },
      { "lesson.liked": true },
    );
    expect(merged).toEqual({
      "lesson.liked": true,
      "comment.replied": false,
    });
  });

  it("writes only the columns the patch carried", () => {
    const update = toUpdate({ pushEnabled: false }, DEFAULT_PREFERENCES);
    expect(update).toEqual({ pushEnabled: false });
    // Not present, so not written — the alternative resets a field this
    // request never mentioned to its default.
    expect("timezone" in update).toBe(false);
    expect("mutedUntil" in update).toBe(false);
  });

  it("clears a mute with an explicit null", () => {
    // Distinct from omitting the field, which leaves the mute alone.
    expect(toUpdate({ mutedUntil: null }, DEFAULT_PREFERENCES)).toEqual({
      mutedUntil: null,
    });
    const until = "2030-01-01T00:00:00.000Z";
    expect(
      toUpdate({ mutedUntil: until }, DEFAULT_PREFERENCES).mutedUntil,
    ).toEqual(new Date(until));
  });
});
