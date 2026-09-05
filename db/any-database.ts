import type { Database } from "@/db/client";
import type { SeedDatabase } from "@/db/seed/connect";

/**
 * A handle from either client.
 *
 * There are two, and they are genuinely different types: the running app uses
 * Neon's HTTP driver (`db/client.ts`), while scripts and the integration tests
 * use the pooled WebSocket driver, because HTTP cannot hold a transaction.
 *
 * Query modules that both worlds call — the notification fan-out, the push
 * queue — accept this rather than one of them, so the call sites do not each
 * need a cast. A cast at every call site is a cast that eventually hides a
 * real mismatch.
 *
 * The cost: the union's methods are the intersection of the two, which is why
 * `.returning()` with a selection is unavailable here. That is a known trade
 * recorded in docs/DATABASE.md, not a surprise to discover per call.
 */
export type AnyDatabase = Database | SeedDatabase;
