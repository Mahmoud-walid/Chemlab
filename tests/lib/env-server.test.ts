import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/lib/env.server.schema";

const VALID = "postgresql://user:pw@ep-x-pooler.eu-central-1.aws.neon.tech/db";
const VALID_DIRECT = "postgresql://user:pw@ep-x.eu-central-1.aws.neon.tech/db";

describe("parseServerEnv", () => {
  it("accepts a pooled URL on its own", () => {
    const env = parseServerEnv({ DATABASE_URL: VALID });
    expect(env.DATABASE_URL).toBe(VALID);
    expect(env.DATABASE_URL_UNPOOLED).toBeUndefined();
  });

  it("accepts both endpoints", () => {
    const env = parseServerEnv({
      DATABASE_URL: VALID,
      DATABASE_URL_UNPOOLED: VALID_DIRECT,
    });
    expect(env.DATABASE_URL_UNPOOLED).toBe(VALID_DIRECT);
  });

  it("accepts the postgres:// scheme as well as postgresql://", () => {
    expect(
      parseServerEnv({ DATABASE_URL: "postgres://u:p@host/db" }).DATABASE_URL,
    ).toBe("postgres://u:p@host/db");
  });

  it("requires DATABASE_URL", () => {
    expect(() => parseServerEnv({})).toThrow(/DATABASE_URL/);
  });

  it("treats an empty string as missing rather than invalid", () => {
    // A blank line in .env should give the same clear error as no line at all.
    expect(() => parseServerEnv({ DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
  });

  it.each([
    ["mysql://user:pw@host/db"],
    ["https://example.com"],
    ["not a url at all"],
    ["/var/run/postgresql"],
  ])("rejects %s, which is not a postgres connection string", (value) => {
    expect(() => parseServerEnv({ DATABASE_URL: value })).toThrow(/postgres/i);
  });

  it("rejects a non-postgres unpooled URL too", () => {
    expect(() =>
      parseServerEnv({
        DATABASE_URL: VALID,
        DATABASE_URL_UNPOOLED: "https://example.com",
      }),
    ).toThrow(/DATABASE_URL_UNPOOLED/);
  });

  it("names every offending variable in one error", () => {
    expect(() =>
      parseServerEnv({ DATABASE_URL: "nope", DATABASE_URL_UNPOOLED: "nope" }),
    ).toThrow(/DATABASE_URL[\s\S]*DATABASE_URL_UNPOOLED/);
  });

  it("warns against the NEXT_PUBLIC_ prefix in its error", () => {
    // The single most damaging mistake available here: a NEXT_PUBLIC_ database
    // URL is inlined into the browser bundle, and Neon URLs carry the password.
    expect(() => parseServerEnv({})).toThrow(/NEXT_PUBLIC_/);
  });

  it("never puts the connection string in the error message", () => {
    const secret = "postgresql://user:hunter2@host/db";
    try {
      parseServerEnv({ DATABASE_URL: secret, DATABASE_URL_UNPOOLED: "bad" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as Error).message).not.toContain("hunter2");
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
