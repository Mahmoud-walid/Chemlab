/**
 * A real pooled connection for the seed and the verifier.
 *
 * Neither runs inside Next.js, so neither can use `db/client.ts`: both need a
 * transaction, which Neon's HTTP driver cannot hold. This opens the pooled
 * WebSocket driver for Neon and plain node-postgres for everything else, and
 * hands back the pool so the caller can close it.
 */
import { neonConfig, Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzleNode } from "drizzle-orm/node-postgres";
import { Pool as NodePool } from "pg";
import ws from "ws";

import { driverFor } from "@/db/driver";
import * as schema from "@/db/schema";

neonConfig.webSocketConstructor = ws;

export type SeedDatabase =
  | ReturnType<typeof drizzleNeon<typeof schema>>
  | ReturnType<typeof drizzleNode<typeof schema>>;

export interface SeedConnection {
  db: SeedDatabase;
  close: () => Promise<void>;
}

/**
 * Resolves the URL the same way for both entry points: the direct endpoint
 * when there is one, because this work is transactional and PgBouncer in
 * transaction mode cannot hold what it needs.
 */
export function seedUrl(): string | undefined {
  return process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
}

export function connect(url: string): SeedConnection {
  if (driverFor(url) === "neon") {
    const pool = new NeonPool({ connectionString: url });
    return {
      db: drizzleNeon(pool, { schema, casing: "snake_case" }),
      close: () => pool.end(),
    };
  }
  const pool = new NodePool({ connectionString: url });
  return {
    db: drizzleNode(pool, { schema, casing: "snake_case" }),
    close: () => pool.end(),
  };
}
