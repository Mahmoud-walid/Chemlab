import "server-only";
import { headers } from "next/headers";

import { getDb } from "@/db/client";
import { auditLog } from "@/db/schema/rbac";

/**
 * The append-only record of authorization changes.
 *
 * A trigger refuses UPDATE and DELETE on this table, so what is written here
 * stays. That is the point: the Super Admin role is the highest-value target in
 * the system, and how somebody came to hold it must be reconstructable after
 * the fact — including by someone investigating the person who granted it.
 */

export interface AuditInput {
  /** `role.create`, `user_role.revoke`, … */
  action: string;
  targetType: "role" | "permission" | "user" | "role_permission" | "user_role";
  targetId?: string | null;
  /** The state before and after, for reconstructing what changed. */
  before?: unknown;
  after?: unknown;
  /** Omit to take it from the session; pass explicitly for scripts. */
  actorId?: string | null;
}

/**
 * Writes one entry.
 *
 * Never swallows its own failure: an audit write that fails silently leaves a
 * mutation with no record, which is worse than the mutation failing. Callers
 * should write the entry inside the same transaction as the change it
 * describes, so neither can exist without the other.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  const requestHeaders = await headers().catch(() => null);

  await getDb()
    .insert(auditLog)
    .values({
      actorId: input.actorId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      // The first entry of X-Forwarded-For, or nothing. A proxy chain appends,
      // so the client address is the leftmost value.
      ipAddress:
        requestHeaders?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: requestHeaders?.get("user-agent") ?? null,
    });
}
