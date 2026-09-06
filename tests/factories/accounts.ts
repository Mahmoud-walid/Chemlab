import * as schema from "@/db/schema";
import type { SeedDatabase } from "@/db/seed/connect";
import { unique } from "./ids";

/**
 * An account, with an address that cannot reach anybody.
 *
 * `.invalid` is reserved by RFC 2606 precisely so it can never resolve, which
 * matters more than it looks: a suite that seeds `@example.com` addresses is
 * one misconfigured mailer away from sending real mail to a domain it does
 * not own.
 */
export interface CreatedUser {
  id: string;
  name: string;
  email: string;
}

export async function createUser(
  db: SeedDatabase,
  overrides: { id?: string; name?: string; email?: string } = {},
): Promise<CreatedUser> {
  const id = overrides.id ?? unique("factory-user");
  const user = {
    id,
    name: overrides.name ?? "A test account",
    email: overrides.email ?? `${id}@factory.invalid`,
  };

  // `onConflictDoNothing` so a suite may name its own id and call this more
  // than once without ordering being part of what it asserts.
  await db.insert(schema.users).values(user).onConflictDoNothing();
  return user;
}

/**
 * Deleting a test account is NOT offered, deliberately.
 *
 * A user who has audited anything cannot be deleted — `audit_log.actor_id` is
 * `on delete set null` and the audit log's trigger refuses UPDATE. A helper
 * that appeared to clean up accounts would fail in exactly the suites that
 * exercise admin actions, which is where it would be reached for. The
 * conflict is recorded as Q40 in docs/DEFERRED_QUESTIONS.md; until it is
 * settled, test accounts are left behind, which costs nothing.
 */
