import { describe, expect, it } from "vitest";

import {
  databaseDiagnostics,
  isNeon,
  isPooledHost,
  resolvedEndpoints,
} from "@/lib/env-diagnostics";

const LOCAL = "postgresql://chemlab:chemlab@127.0.0.1:5432/chemlab";
const NEON_POOLED =
  "postgresql://u:p@ep-cool-name-123456-pooler.eu-central-1.aws.neon.tech/chemlab?sslmode=require";
const NEON_DIRECT =
  "postgresql://u:p@ep-cool-name-123456.eu-central-1.aws.neon.tech/chemlab?sslmode=require";

describe("recognising an endpoint", () => {
  it("spots a pooled Neon host by its '-pooler' segment", () => {
    expect(isPooledHost(NEON_POOLED)).toBe(true);
    expect(isPooledHost(NEON_DIRECT)).toBe(false);
    expect(isPooledHost(LOCAL)).toBe(false);
  });

  it("says nothing useful about an unparseable URL rather than throwing", () => {
    // The schema reports a malformed connection string with a much better
    // message. This must not crash the report before that happens.
    expect(isPooledHost("not a url")).toBe(false);
    expect(isNeon("not a url")).toBe(false);
  });
});

describe("a local cluster", () => {
  it("is clean, even with both variables pointing at the same URL", () => {
    // There is no pooler in front of a local Postgres, so the direct and the
    // app endpoint ARE the same. It looks like a copy-paste mistake; it is
    // the documented local setup.
    expect(
      databaseDiagnostics({
        DATABASE_URL: LOCAL,
        DATABASE_URL_UNPOOLED: LOCAL,
      }),
    ).toEqual([]);
  });

  it("is clean with no direct endpoint at all", () => {
    expect(databaseDiagnostics({ DATABASE_URL: LOCAL })).toEqual([]);
  });

  it("says nothing when there is no database configured", () => {
    // The app, the build and the whole test suite run without one.
    expect(databaseDiagnostics({})).toEqual([]);
  });
});

describe("a Neon deployment", () => {
  it("is clean with a pooled app URL and a direct one beside it", () => {
    expect(
      databaseDiagnostics({
        DATABASE_URL: NEON_POOLED,
        DATABASE_URL_UNPOOLED: NEON_DIRECT,
      }),
    ).toEqual([]);
  });

  it("refuses a pooled URL with no direct endpoint", () => {
    // The expensive one: migrations fail on a session lock deep inside
    // drizzle-kit, and the analytics client's statement_timeout silently
    // stops applying because the next statement may land on another backend.
    const found = databaseDiagnostics({ DATABASE_URL: NEON_POOLED });
    expect(found).toHaveLength(1);
    expect(found[0]?.level).toBe("error");
    expect(found[0]?.detail).toMatch(/statement_timeout/);
  });

  it("refuses a direct variable that points at the pooler", () => {
    const found = databaseDiagnostics({
      DATABASE_URL: NEON_POOLED,
      DATABASE_URL_UNPOOLED: NEON_POOLED,
    });
    expect(found.map((entry) => entry.level)).toEqual(["error"]);
    expect(found[0]?.summary).toMatch(/UNPOOLED points at a pooled/);
  });

  it("warns about a missing sslmode on either endpoint", () => {
    const found = databaseDiagnostics({
      DATABASE_URL: NEON_POOLED.replace("?sslmode=require", ""),
      DATABASE_URL_UNPOOLED: NEON_DIRECT.replace("?sslmode=require", ""),
    });
    expect(found.filter((entry) => entry.level === "warning")).toHaveLength(2);
  });

  it("reports every problem at once, not the first", () => {
    // Somebody who fixes one and is then told about the next has been made to
    // discover the rules one deploy at a time.
    const found = databaseDiagnostics({
      DATABASE_URL: NEON_POOLED.replace("?sslmode=require", ""),
      DATABASE_URL_UNPOOLED: NEON_POOLED,
    });
    expect(found.length).toBeGreaterThan(1);
  });
});

describe("resolvedEndpoints", () => {
  it("shows migrations and analytics preferring the direct endpoint", () => {
    expect(
      resolvedEndpoints({
        DATABASE_URL: NEON_POOLED,
        DATABASE_URL_UNPOOLED: NEON_DIRECT,
      }),
    ).toEqual({
      app: NEON_POOLED,
      migrations: NEON_DIRECT,
      analytics: NEON_DIRECT,
    });
  });

  it("shows both falling back to the app URL when there is no direct one", () => {
    // This is exactly the fallback the error above is about: it is silent,
    // and the report is where it stops being silent.
    expect(resolvedEndpoints({ DATABASE_URL: LOCAL })).toEqual({
      app: LOCAL,
      migrations: LOCAL,
      analytics: LOCAL,
    });
  });
});
