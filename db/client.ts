import "server-only";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";
import { getServerEnv } from "@/lib/env.server";

/**
 * The database client, constructed on first use.
 *
 * Lazy on purpose: `pnpm build` runs with no database reachable, and a client
 * built at module scope would validate `DATABASE_URL` — and fail — simply
 * because a file imported this one.
 */
let cached: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getDb() {
  cached ??= drizzle(neon(getServerEnv().DATABASE_URL), {
    schema,
    casing: "snake_case",
  });
  return cached;
}

export type Database = ReturnType<typeof getDb>;
