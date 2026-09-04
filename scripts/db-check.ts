/**
 * Proves the database is reachable and reports what is applied.
 *
 *   pnpm db:check
 *
 * Exits non-zero on any failure, so it is usable as a deploy gate.
 */
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error(
      [
        "DATABASE_URL is not set.",
        "",
        "Set it in .env.local for local work, or in the deployment's",
        "environment variables. It is a server-only secret — never give it a",
        "NEXT_PUBLIC_ prefix, which would publish it to every visitor.",
      ].join("\n"),
    );
    process.exit(1);
  }

  const sql = neon(url);
  const startedAt = Date.now();

  try {
    const [{ version }] = (await sql`select version()`) as {
      version: string;
    }[];
    const latencyMs = Date.now() - startedAt;

    // The migrations table only exists once a migration has been applied.
    let applied: number | null = null;
    try {
      const rows = (await sql`
        select count(*)::int as count from drizzle.__drizzle_migrations
      `) as { count: number }[];
      applied = rows[0]?.count ?? 0;
    } catch {
      applied = null;
    }

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
  }
}

void main();
