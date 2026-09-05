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
    const byId = { kind: "id" as const, id: "abc" };
    const score = { kind: "score" as const, score: -3, id: "def" };

    expect(decodeCursor(encodeCursor(byId))).toEqual(byId);
    expect(decodeCursor(encodeCursor(score))).toEqual(score);
  });

  it("carries no timestamp, which is what made a page come back empty", () => {
    // `Date.toISOString()` is millisecond precision; Postgres `timestamptz` is
    // microsecond. A cursor carrying the truncated value matched no row on the
    // equality half of the keyset predicate and excluded the whole millisecond
    // on the other — so the page after a burst of comments was EMPTY. UUID v7
    // ids order by time, are unique, and round-trip exactly.
    const encoded = encodeCursor({ kind: "id", id: "abc" });
    expect(JSON.parse(Buffer.from(encoded, "base64url").toString())).toEqual({
      kind: "id",
      id: "abc",
    });
  });

  it("is opaque, so no client can come to depend on its fields", () => {
    const encoded = encodeCursor({ kind: "id", id: "abc" });
    // base64url: no padding, no characters that need escaping in a query
    // string.
    expect(encoded).not.toContain("=");
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain('id":');
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
      { kind: "id", id: 7 },
      { kind: "id" },
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
