import { beforeAll } from "vitest";

/**
 * Integration setup: a real Postgres, migrated from empty to head.
 *
 * Deliberately fails loudly rather than silently falling back to a mock — a
 * green integration run that touched no database is worse than no run at all.
 */
beforeAll(() => {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      [
        "DATABASE_URL is not set, so the integration suite has no database.",
        "",
        "Locally:  docker compose up -d postgres   (see tests/README.md)",
        "In CI:    the postgres service container sets it automatically.",
        "",
        "These tests exist to prove SQL and migrations against real Postgres.",
        "Running them against a mock would defeat their only purpose.",
      ].join("\n"),
    );
  }

  // Migrations are applied here once the Drizzle schema lands (issue #10):
  //   await migrate(drizzle(sql), { migrationsFolder: "db/migrations" });
  // Isolation between tests is per tests/README.md — a transaction rolled back
  // where the code under test allows it, TRUNCATE ... RESTART IDENTITY CASCADE
  // where a server action manages its own transaction.
});
