"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { countSuperAdminHolders, listRoles } from "@/db/queries/admin/roles";
import { auditLog, roles, userRoles } from "@/db/schema/rbac";
import { recordActivity } from "@/lib/activity/record";
import { requirePermission } from "@/lib/authz";
import {
  refusalsForAssign,
  refusalsForRevoke,
  type AssignRefusal,
  type RevokeRefusal,
  type RoleFacts,
} from "@/lib/authz-roles";

/**
 * Granting and revoking a role.
 *
 * `role:assign` is the gate, and it is only half the answer — **which** role is
 * the other half, and it lives in `lib/authz-roles.ts` so it can be tested
 * without a database. See the escalation argument there; the short version is
 * that an Admin holds `role:assign`, and if that alone were enough to grant
 * `super_admin` then the two roles are one.
 *
 * Both actions re-read the roles and the Super Admin holder count from the
 * database rather than trusting anything the page rendered. A page can be
 * minutes old: the role could have been edited, the last other Super Admin
 * could have been removed, and a decision made from stale props is a decision
 * made about a system that no longer exists.
 */

/**
 * Refusal CODES, not sentences.
 *
 * The rest of the admin's actions return an English `problem` string. That was
 * fine where nothing translated it; here the reader may be on `/ar/admin`, and
 * an English refusal on an Arabic page is the one place this panel would switch
 * language mid-sentence. The client maps these to `admin.roles.refusals.*`.
 */
export interface RoleChangeResult<TRefusal extends string> {
  ok: boolean;
  refusals?: TRefusal[];
  /** Set when the role or the user no longer exists — a stale page, not a rule. */
  gone?: boolean;
}

/** The roles the target holds, and the facts each one carries. */
async function factsFor(userId: string) {
  const all = await listRoles();
  const held = await getDb()
    .select({ key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));

  return {
    all,
    heldKeys: held.map((row) => row.key),
  };
}

function toFacts(row: {
  key: string;
  permissionNames: string[];
  isSystem: boolean;
  isProtected: boolean;
}): RoleFacts {
  return {
    key: row.key,
    permissionNames: row.permissionNames,
    isSystem: row.isSystem,
    isProtected: row.isProtected,
  };
}

function afterChange(userId: string) {
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
  revalidatePath("/admin/roles");
}

export async function assignRole(input: {
  /**
   * The person receiving the role.
   *
   * A TARGET id, never the actor's — the actor comes from the session, above.
   * `tests/lib/authz-enforcement.test.ts` greps for a user id read out of a
   * request body or query string; this is a typed argument to a server action
   * whose first statement is the gate, which is the distinction that matters.
   */
  userId: string;
  roleId: string;
}): Promise<RoleChangeResult<AssignRefusal>> {
  const actor = await requirePermission("role:assign");

  const { all, heldKeys } = await factsFor(input.userId);
  const role = all.find((candidate) => candidate.id === input.roleId);
  if (!role) return { ok: false, gone: true };

  const refusals = refusalsForAssign({
    actor,
    role: toFacts(role),
    targetRoleKeys: heldKeys,
  });
  if (refusals.length > 0) return { ok: false, refusals };

  await getDb().transaction(async (tx) => {
    await tx
      .insert(userRoles)
      .values({
        userId: input.userId,
        roleId: input.roleId,
        assignedBy: actor.userId,
      })
      // Idempotent against a double submit. The refusal above already covers
      // "already held" for a reader who can see the page; this covers the race
      // between two tabs, where neither read is wrong and one insert must lose.
      .onConflictDoNothing();

    // In the SAME transaction as the grant, so neither can exist without the
    // other — `lib/audit.ts` says why, and this is the row that matters most:
    // how somebody came to hold a role has to be reconstructable afterwards.
    await tx.insert(auditLog).values({
      actorId: actor.userId,
      action: "user_role.assign",
      targetType: "user_role",
      targetId: input.userId,
      before: { roles: heldKeys },
      after: { roles: [...heldKeys, role.key].sort(), granted: role.key },
    });
  });

  await recordActivity({
    verb: "admin.role_assigned",
    objectType: "user",
    objectId: input.userId,
    metadata: { role: role.key },
  });

  afterChange(input.userId);
  return { ok: true };
}

export async function revokeRole(input: {
  userId: string;
  roleId: string;
}): Promise<RoleChangeResult<RevokeRefusal>> {
  const actor = await requirePermission("role:assign");

  const { all, heldKeys } = await factsFor(input.userId);
  const role = all.find((candidate) => candidate.id === input.roleId);
  if (!role) return { ok: false, gone: true };

  const refusals = refusalsForRevoke({
    actor,
    targetUserId: input.userId,
    role: toFacts(role),
    targetRoleKeys: heldKeys,
    remainingRoles: all
      .filter(
        (candidate) =>
          candidate.key !== role.key && heldKeys.includes(candidate.key),
      )
      .map(toFacts),
    // Counted now, not taken from the page. "Is this the last Super Admin" is
    // exactly the question whose answer changes under you.
    superAdminHolders: await countSuperAdminHolders(),
  });
  if (refusals.length > 0) return { ok: false, refusals };

  await getDb().transaction(async (tx) => {
    await tx
      .delete(userRoles)
      .where(
        and(
          eq(userRoles.userId, input.userId),
          eq(userRoles.roleId, input.roleId),
        ),
      );

    await tx.insert(auditLog).values({
      actorId: actor.userId,
      action: "user_role.revoke",
      targetType: "user_role",
      targetId: input.userId,
      before: { roles: heldKeys },
      after: {
        roles: heldKeys.filter((key) => key !== role.key),
        revoked: role.key,
      },
    });
  });

  await recordActivity({
    verb: "admin.role_revoked",
    objectType: "user",
    objectId: input.userId,
    metadata: { role: role.key },
  });

  afterChange(input.userId);
  return { ok: true };
}
