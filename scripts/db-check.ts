/**
 * Proves the database is reachable and reports what is applied.
 *
 *   pnpm db:check
 *
 * Exits non-zero on any failure, so it is usable as a deploy gate. Works
 * against either driver — see `db/driver.ts`.
 */
import "@/lib/load-env";
import { neon } from "@neondatabase/serverless";
import { Pool } from "pg";
import { driverFor } from "@/db/driver";

async function main() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error(
      [
        "DATABASE_URL is not set.",
        "",
        "Copy .env.example to .env.local and fill it in, or start the local",
        "database with `pnpm db:local:start`.",
        "",
        "It is a server-only secret — never give it a NEXT_PUBLIC_ prefix,",
        "which would publish it to every visitor.",
      ].join("\n"),
    );
    process.exit(1);
  }

  const kind = driverFor(url);
  const pool =
    kind === "node-postgres" ? new Pool({ connectionString: url }) : undefined;

  /** One shape over both drivers, so the checks below read the same. */
  const query = async (text: string): Promise<Record<string, unknown>[]> => {
    if (pool) return (await pool.query(text)).rows;
    // neon()'s callable form is a tagged template; .query() takes a string.
    return (await neon(url).query(text)) as Record<string, unknown>[];
  };

  const startedAt = Date.now();

  try {
    const rows = await query("select version()");
    const version = String(rows[0]?.version ?? "unknown");
    const latencyMs = Date.now() - startedAt;

    // The migrations table only exists once a migration has been applied.
    let applied: number | null = null;
    try {
      const counted = await query(
        "select count(*)::int as count from drizzle.__drizzle_migrations",
      );
      applied = Number(counted[0]?.count ?? 0);
    } catch {
      applied = null;
    }

    console.log(`driver        ${kind}`);
    console.log(`ok            ${latencyMs}ms`);
    console.log(`server        ${version.split(",")[0]}`);
    console.log(
      applied === null
        ? "migrations    none applied yet (run pnpm db:migrate)"
        : `migrations    ${applied} applied`,
    );
  } catch (error) {
    // Deliberately not echoing the URL: it carries the password inline.
    console.error("Could not reach the database.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await pool?.end();
  }
}

void main();
