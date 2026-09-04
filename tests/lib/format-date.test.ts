import { describe, expect, it } from "vitest";
import {
  formatDateTime,
  formatLongDate,
  formatShortDate,
} from "@/lib/format-date";

const UTC = { locale: "en-US", timeZone: "UTC" } as const;

describe("formatShortDate", () => {
  // These expectations are the exact output of the moment format string
  // ("MMM DD, YYYY") this helper replaced, so rendered pages are unchanged.
  it.each([
    ["2026-03-17T10:30:00Z", "Mar 17, 2026"],
    ["2026-01-07T00:00:00Z", "Jan 07, 2026"],
    ["1999-12-31T23:59:59Z", "Dec 31, 1999"],
    ["2000-02-29T00:00:00Z", "Feb 29, 2000"],
  ])("formats %s as %s", (input, expected) => {
    expect(formatShortDate(input, UTC)).toBe(expected);
  });

  it("zero-pads single-digit days, as the previous formatter did", () => {
    expect(formatShortDate("2026-09-04T12:00:00Z", UTC)).toBe("Sep 04, 2026");
  });

  it("accepts a Date, an ISO string and a timestamp alike", () => {
    const iso = "2026-03-17T10:30:00Z";
    const expected = "Mar 17, 2026";
    expect(formatShortDate(new Date(iso), UTC)).toBe(expected);
    expect(formatShortDate(iso, UTC)).toBe(expected);
    expect(formatShortDate(Date.parse(iso), UTC)).toBe(expected);
  });

  it("localises, which is why Intl replaced the date libraries", () => {
    const arabic = formatShortDate("2026-03-17T10:30:00Z", {
      locale: "ar-EG",
      timeZone: "UTC",
    });
    expect(arabic).not.toBe("Mar 17, 2026");
    expect(arabic.length).toBeGreaterThan(0);
  });

  it("respects the time zone", () => {
    // 23:30 UTC is already the next day in Tokyo.
    expect(
      formatShortDate("2026-03-17T23:30:00Z", {
        locale: "en-US",
        timeZone: "Asia/Tokyo",
      }),
    ).toBe("Mar 18, 2026");
  });

  it("returns an empty string for an unparseable date instead of throwing", () => {
    expect(formatShortDate("not a date", UTC)).toBe("");
    expect(formatShortDate(Number.NaN, UTC)).toBe("");
  });
});

describe("formatLongDate", () => {
  it("spells the month out, in the locale's own order", () => {
    expect(formatLongDate("2026-03-17T10:30:00Z", UTC)).toBe("March 17, 2026");
    expect(
      formatLongDate("2026-03-17T10:30:00Z", {
        locale: "en-GB",
        timeZone: "UTC",
      }),
    ).toBe("17 March 2026");
  });

  it("returns an empty string for an invalid date", () => {
    expect(formatLongDate("nope", UTC)).toBe("");
  });
});

describe("formatDateTime", () => {
  it("includes the time", () => {
    const formatted = formatDateTime("2026-03-17T10:30:00Z", UTC);
    expect(formatted).toContain("Mar 17, 2026");
    expect(formatted).toMatch(/10:30/);
  });

  it("returns an empty string for an invalid date", () => {
    expect(formatDateTime("nope", UTC)).toBe("");
  });
});
