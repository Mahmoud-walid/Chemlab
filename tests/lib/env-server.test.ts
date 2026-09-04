import { describe, expect, it } from "vitest";
import {
  authConfigured,
  googleConfigured,
  parseServerEnv,
} from "@/lib/env.server.schema";

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

  it("accepts an absent DATABASE_URL", () => {
    // The app genuinely runs without a database: `pnpm build`, the test suite
    // and every public page do. Merely READING configuration must not throw on
    // a deployment that has none — `getDb()` raises the specific error at the
    // point where something actually wants to query.
    expect(() => parseServerEnv({})).not.toThrow();
    expect(parseServerEnv({}).DATABASE_URL).toBeUndefined();
  });

  it("treats an empty string as missing rather than invalid", () => {
    // A blank line in .env means "unset", not "malformed".
    expect(parseServerEnv({ DATABASE_URL: "" }).DATABASE_URL).toBeUndefined();
  });

  it("still validates DATABASE_URL when it IS set", () => {
    // Optional does not mean unchecked: a typo should fail loudly rather than
    // silently becoming "no database".
    expect(() => parseServerEnv({ DATABASE_URL: "mysql://host/db" })).toThrow(
      /postgres/i,
    );
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
    // URL is inlined into the browser bundle, and a hosted Postgres URL carries
    // its password.
    expect(() => parseServerEnv({ DATABASE_URL: "nope" })).toThrow(
      /NEXT_PUBLIC_/,
    );
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

describe("authConfigured / googleConfigured", () => {
  const secret = "a".repeat(32);

  it("reports auth off until both the secret and the URL are set", () => {
    expect(authConfigured({})).toBe(false);
    expect(authConfigured({ BETTER_AUTH_SECRET: secret })).toBe(false);
    expect(authConfigured({ BETTER_AUTH_URL: "http://localhost:3000" })).toBe(
      false,
    );
    expect(
      authConfigured({
        BETTER_AUTH_SECRET: secret,
        BETTER_AUTH_URL: "http://localhost:3000",
      }),
    ).toBe(true);
  });

  it("requires both halves of the Google credential", () => {
    const base = {
      BETTER_AUTH_SECRET: secret,
      BETTER_AUTH_URL: "http://localhost:3000",
    };
    // One without the other is a misconfiguration that would fail at the
    // callback, so it counts as "not configured" rather than half-enabled.
    expect(googleConfigured({ ...base, GOOGLE_CLIENT_ID: "id" })).toBe(false);
    expect(googleConfigured({ ...base, GOOGLE_CLIENT_SECRET: "s" })).toBe(
      false,
    );
    expect(
      googleConfigured({
        ...base,
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "s",
      }),
    ).toBe(true);
  });

  it("never reports Google as available while auth itself is off", () => {
    expect(
      googleConfigured({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s" }),
    ).toBe(false);
  });

  it("rejects a secret too short to be worth signing with", () => {
    expect(() => parseServerEnv({ BETTER_AUTH_SECRET: "too-short" })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it("rejects a BETTER_AUTH_URL that is not an absolute http(s) origin", () => {
    for (const value of ["localhost:3000", "ftp://example.com", "/auth"]) {
      expect(() => parseServerEnv({ BETTER_AUTH_URL: value }), value).toThrow(
        /BETTER_AUTH_URL/,
      );
    }
  });
});
