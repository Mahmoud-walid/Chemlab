/**
 * Drops and recreates the local schema, then re-applies migrations.
 *
 *   pnpm db:local:reset
 *
 * For the disposable local database only. It refuses to touch anything that
 * is not obviously local, because "reset the database" is the kind of command
 * that must never work by accident against something real.
 */
import "@/lib/load-env";
import { Pool } from "pg";
import { driverFor } from "@/db/driver";

const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "postgres",
  "db",
]);

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const { hostname } = new URL(url);

  if (driverFor(url) === "neon" || !LOCAL_HOSTS.has(hostname)) {
    console.error(
      `Refusing to reset "${hostname}" — this command is for a local database ` +
        `only.\nAllowed hosts: ${[...LOCAL_HOSTS].join(", ")}`,
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  try {
    await pool.query("drop schema if exists public cascade");
    await pool.query("create schema public");
    // Drizzle keeps its migration journal in its own schema.
    await pool.query("drop schema if exists drizzle cascade");
    console.log(`reset ${hostname}: public and drizzle schemas dropped`);
    console.log("run pnpm db:migrate && pnpm db:seed to rebuild");
  } finally {
    await pool.end();
  }
}

void main();
