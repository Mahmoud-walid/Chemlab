import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  pageSize,
} from "@/lib/comments/cursor";

/**
 * A cursor is attacker-controlled input that goes straight into a WHERE
 * clause, so what happens to a bad one matters more than what happens to a
 * good one.
 */

describe("round trip", () => {
  it("survives encoding for both orderings", () => {
    const time = {
      kind: "time" as const,
      createdAt: "2026-03-10T09:00:00.000Z",
      id: "abc",
    };
    const score = { kind: "score" as const, score: -3, id: "def" };

    expect(decodeCursor(encodeCursor(time))).toEqual(time);
    expect(decodeCursor(encodeCursor(score))).toEqual(score);
  });

  it("is opaque, so no client can come to depend on its fields", () => {
    const encoded = encodeCursor({
      kind: "time",
      createdAt: "2026-03-10T09:00:00.000Z",
      id: "abc",
    });
    // base64url: no padding, no characters that need escaping in a query
    // string.
    expect(encoded).not.toContain("=");
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("createdAt");
  });
});

describe("a cursor we did not issue", () => {
  it("is rejected rather than thrown on", () => {
    // Null, so the route answers 400. A throw here is a 500, which tells an
    // attacker they found something.
    for (const value of [
      "not-base64!!",
      Buffer.from("not json").toString("base64url"),
      Buffer.from("[]").toString("base64url"),
      Buffer.from('{"kind":"elsewhere"}').toString("base64url"),
      "",
      null,
      undefined,
    ]) {
      expect(decodeCursor(value), String(value)).toBeNull();
    }
  });

  it("is rejected when a field has the wrong type", () => {
    // The types are checked because these values reach a comparison in SQL.
    const bad = [
      { kind: "time", createdAt: 12345, id: "a" },
      { kind: "time", createdAt: "2026-03-10T09:00:00.000Z", id: 7 },
      { kind: "time", createdAt: "not a date", id: "a" },
      { kind: "score", score: "9", id: "a" },
      { kind: "score", score: Number.POSITIVE_INFINITY, id: "a" },
    ];

    for (const candidate of bad) {
      expect(
        decodeCursor(
          Buffer.from(JSON.stringify(candidate)).toString("base64url"),
        ),
        JSON.stringify(candidate),
      ).toBeNull();
    }
  });
});

describe("the page size", () => {
  it("is bounded, so nobody can ask for the whole table", () => {
    expect(pageSize("1000")).toBe(MAX_PAGE_SIZE);
    expect(pageSize(10_000)).toBe(MAX_PAGE_SIZE);
  });

  it("falls back to the default for anything that is not a size", () => {
    for (const value of ["", "abc", "-5", "0", null, undefined, Number.NaN]) {
      expect(pageSize(value), String(value)).toBe(DEFAULT_PAGE_SIZE);
    }
  });

  it("takes a sensible request at face value", () => {
    expect(pageSize("5")).toBe(5);
    expect(pageSize(20)).toBe(20);
    // A fractional page is a whole number of rows.
    expect(pageSize("7.9")).toBe(7);
  });
});
