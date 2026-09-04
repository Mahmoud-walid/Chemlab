import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";

/** Never prerendered: a health check answers for the moment it is called. */
export const dynamic = "force-dynamic";

/**
 * Database liveness.
 *
 * Returns only `ok` and a latency figure. Connection strings, hostnames and
 * raw driver errors stay server-side — this endpoint is public, and Neon URLs
 * carry credentials inline.
 */
export async function GET() {
  const startedAt = Date.now();

  try {
    await getDb().execute(sql`select 1`);
    return NextResponse.json({ ok: true, latencyMs: Date.now() - startedAt });
  } catch (error) {
    console.error("Database health check failed", error);
    return NextResponse.json(
      { ok: false, error: "database unavailable" },
      { status: 503 },
    );
  }
}
