import { execFileSync } from "node:child_process";
import { beforeAll } from "vitest";

import "@/lib/load-env";
import { driverFor } from "@/db/driver";

/**
 * Integration setup: a real Postgres, migrated from empty to head and seeded.
 *
 * Deliberately fails loudly rather than silently falling back to a mock — a
 * green integration run that touched no database is worse than no run at all.
 *
 * Migration and seeding go through the same `pnpm db:migrate` / `pnpm db:seed`
 * entry points the developer and CI use, rather than a test-only copy. That
 * makes the seed itself part of what these tests prove: if seeding breaks, the
 * suite fails here instead of asserting against a fixture that drifted.
 */

const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "postgres",
  "db",
]);

/**
 * These tests write to whatever database they are pointed at. A developer with
 * a production URL exported in their shell should get an error, not a seeded
 * production database.
 */
function assertDisposable(url: string): void {
  const { hostname, pathname } = new URL(url);
  const database = pathname.replace(/^\//, "");
  const isLocal = LOCAL_HOSTS.has(hostname);
  const looksLikeATestDatabase = /test/i.test(database);

  if (driverFor(url) === "neon" || (!isLocal && !looksLikeATestDatabase)) {
    throw new Error(
      [
        `Refusing to run the integration suite against "${database}" on ${hostname}.`,
        "",
        "These tests migrate, seed and truncate. Point DATABASE_URL at a local",
        "cluster (pnpm db:local:start) or at a database whose name contains",
        '"test" — anything else is assumed to be real.',
      ].join("\n"),
    );
  }
}

beforeAll(() => {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      [
        "DATABASE_URL is not set, so the integration suite has no database.",
        "",
        "Locally:  pnpm db:local:start   (see tests/README.md)",
        "In CI:    the postgres service container sets it automatically.",
        "",
        "These tests exist to prove SQL and migrations against real Postgres.",
        "Running them against a mock would defeat their only purpose.",
      ].join("\n"),
    );
  }

  assertDisposable(url);

  const run = (script: string) =>
    execFileSync("pnpm", ["exec", "tsx", script], {
      stdio: "pipe",
      env: process.env,
    });

  run("scripts/db-migrate.ts");
  run("scripts/seed.ts");
});
