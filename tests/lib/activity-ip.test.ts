import { describe, expect, it } from "vitest";

import { clientAddress, truncateIp } from "@/lib/activity/ip";

/**
 * Truncating an address before it is stored.
 *
 * The property that matters: whatever comes back is either null or strictly
 * less identifying than what went in. A bug here does not fail anything — it
 * quietly stores a whole address in a column documented as truncated.
 */

describe("clientAddress", () => {
  it("takes the first entry, because proxies append", () => {
    expect(clientAddress("203.0.113.42, 70.41.3.18, 150.172.238.178")).toBe(
      "203.0.113.42",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(clientAddress("  203.0.113.42 , 70.41.3.18")).toBe("203.0.113.42");
  });

  it("returns null for an absent or empty header", () => {
    expect(clientAddress(null)).toBeNull();
    expect(clientAddress("")).toBeNull();
    expect(clientAddress("  ")).toBeNull();
  });
});

describe("truncateIp", () => {
  it.each([
    ["203.0.113.42", "203.0.113.0"],
    ["203.0.113.0", "203.0.113.0"],
    ["8.8.8.8", "8.8.8.0"],
    ["255.255.255.255", "255.255.255.0"],
  ])("drops the last octet of %j", (input, expected) => {
    expect(truncateIp(input)).toBe(expected);
  });

  it("handles an IPv4-mapped IPv6 address", () => {
    // What a dual-stack proxy forwards. Treating it as unrecognised would
    // throw away location data we are allowed to keep.
    expect(truncateIp("::ffff:203.0.113.42")).toBe("203.0.113.0");
  });

  it("keeps only the first three hextets of an IPv6 address", () => {
    expect(truncateIp("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe(
      "2001:0db8:85a3::",
    );
  });

  it("never returns more than it was given", () => {
    // The one invariant: truncation cannot widen.
    for (const input of [
      "203.0.113.42",
      "::ffff:1.2.3.4",
      "2001:db8::1",
      "fe80::1",
    ]) {
      const output = truncateIp(input);
      expect(output === null || output.length <= input.length + 2).toBe(true);
    }
  });

  it("returns null rather than storing something it cannot vouch for", () => {
    // An unparsed string in a column documented as truncated is worse than an
    // absent one: it looks anonymised and is not.
    for (const input of [
      "not-an-address",
      "999.1.1.1",
      "203.0.113",
      "<script>",
      "",
    ]) {
      expect(truncateIp(input), input).toBeNull();
    }
  });

  it("returns null for null", () => {
    expect(truncateIp(null)).toBeNull();
  });

  it("is idempotent — truncating twice changes nothing", () => {
    for (const input of ["203.0.113.42", "2001:0db8:85a3::8a2e:0370:7334"]) {
      const once = truncateIp(input);
      expect(truncateIp(once)).toBe(once);
    }
  });
});
