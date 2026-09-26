import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

import { driverFor } from "@/db/driver";

/**
 * The app's database client must be able to hold a transaction.
 *
 * This is the one property no other suite can observe. `driverFor()` picks the
 * driver from the hostname, and every suite here runs against plain Postgres,
 * where `node-postgres` holds transactions perfectly well — so a Neon-only
 * failure passes CI, passes locally, and reaches production untouched. The
 * whole write surface of the admin panel and exam submission wrap their writes
 * in `getDb().transaction(...)`, so the failure is not a degraded mode: it is
 * every one of them throwing.
 *
 * Two halves, deliberately. The first pins the FACT that makes the rule
 * necessary, so the rule is not folklore — if a future drizzle teaches the HTTP
 * driver to hold a transaction, that test fails and says the rule can be
 * relaxed. The second pins the RULE, and is what fails when somebody swaps the
 * driver back for the read latency.
 */

const ROOT = process.cwd();

/** A Neon pooled URL, of the shape production uses. */
const NEON_URL =
  "postgresql://u:p@ep-example-123456-pooler.us-east-2.aws.neon.tech/db?sslmode=require";

describe("the fact the rule rests on", () => {
  it("routes a *.neon.tech URL to the Neon driver", () => {
    // If this ever stops being true the rule below still holds, but it stops
    // being about production — so it is asserted rather than assumed.
    expect(driverFor(NEON_URL)).toBe("neon");
  });

  it("cannot hold a transaction over Neon's HTTP driver", async () => {
    // No network: drizzle's HTTP session throws from `transaction()` before it
    // would connect, which is why a fake host is enough and why this test is
    // fast and offline.
    const db = drizzleHttp(neon(NEON_URL), { casing: "snake_case" });

    await expect(db.transaction(async () => {})).rejects.toThrow(
      /No transactions support in neon-http driver/,
    );
  });
});

describe("the app's client", () => {
  it("does not build its Neon handle on the HTTP driver", async () => {
    const source = await readFile(path.join(ROOT, "db/client.ts"), "utf8");

    // The failure this prevents: `getDb().transaction(...)` throwing on every
    // call in production while every suite stays green, because the suites run
    // on node-postgres and production runs on Neon.
    expect(source).not.toMatch(/from\s+"drizzle-orm\/neon-http"/);
    expect(source).toMatch(/from\s+"drizzle-orm\/neon-serverless"/);
  });

  it("migrates Neon on a driver whose migrator is atomic", async () => {
    const source = await readFile(
      path.join(ROOT, "scripts/db-migrate.ts"),
      "utf8",
    );

    // Drizzle's shared pg migrator wraps the run in one transaction and writes
    // each `__drizzle_migrations` row inside it. `neon-http` cannot, so it ships
    // its own loop with every bookkeeping row deferred to the end — and a
    // failure halfway leaves the schema migrated with nothing recorded, which
    // the next run replays on top of itself.
    expect(source).not.toMatch(/from\s+"drizzle-orm\/neon-http(\/migrator)?"/);
    expect(source).toMatch(/from\s+"drizzle-orm\/neon-serverless\/migrator"/);
  });

  it("uses the same Neon driver the seed and the integration tests use", async () => {
    // `db/seed/connect.ts` reached this conclusion first, for the same reason.
    // Two clients on two drivers means the suites prove things about a driver
    // the app does not run — so they are pinned together rather than left to
    // drift.
    const [client, connect] = await Promise.all([
      readFile(path.join(ROOT, "db/client.ts"), "utf8"),
      readFile(path.join(ROOT, "db/seed/connect.ts"), "utf8"),
    ]);

    const neonDriverOf = (source: string) =>
      source.match(/from\s+"(drizzle-orm\/neon-[a-z]+)"/)?.[1];

    expect(neonDriverOf(client)).toBe(neonDriverOf(connect));
  });
});

/**
 * Every `.transaction(` in the app goes through `getDb()`.
 *
 * The rule above is only worth anything if the call sites it protects actually
 * use that client. A file that builds its own HTTP client and calls
 * `.transaction()` on it would be broken in exactly the original way, and the
 * import assertion above would not see it.
 */
describe("transaction call sites", () => {
  async function sourceFiles(dir: string): Promise<string[]> {
    const entries = await readdir(path.join(ROOT, dir), {
      withFileTypes: true,
    });
    const files: string[] = [];
    for (const entry of entries) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) files.push(...(await sourceFiles(rel)));
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
        files.push(rel);
    }
    return files;
  }

  it("never reach for the HTTP driver directly", async () => {
    const dirs = ["app", "db", "lib"];
    const offenders: string[] = [];

    for (const dir of dirs) {
      for (const file of await sourceFiles(dir)) {
        const source = await readFile(path.join(ROOT, file), "utf8");
        if (!source.includes(".transaction(")) continue;
        if (source.includes("drizzle-orm/neon-http")) offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});
