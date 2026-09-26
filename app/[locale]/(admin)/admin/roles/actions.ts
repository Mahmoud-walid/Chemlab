"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { getDb } from "@/db/client";
import { listRoles } from "@/db/queries/admin/roles";
import {
  auditLog,
  permissions,
  rolePermissions,
  roles,
} from "@/db/schema/rbac";
import { recordActivity } from "@/lib/activity/record";
import { requirePermission } from "@/lib/authz";
import {
  refusalsForPermissionEdit,
  refusalsForRoleCreate,
  refusalsForRoleDelete,
  type PermissionEditRefusal,
  type RoleCreateRefusal,
  type RoleDeleteRefusal,
} from "@/lib/authz-roles";

/**
 * Defining roles at runtime, which is the whole point of authorization being
 * data rather than constants.
 *
 * Each action has its own permission — `role:create`, `role:update`,
 * `role:delete` — and today no seeded role but Super Admin holds any of them.
 * That is deliberate and not an oversight: `db/seed/rbac.ts` gives Admin
 * `role:read` and `role:assign` only, so an Admin can staff the roles that
 * exist without being able to invent one.
 *
 * The rules each action enforces are in `lib/authz-roles.ts`, pure and
 * exhaustively tested. The most important of them is that a SYSTEM role's
 * grants cannot be edited here at all: `db/seed/authorization.ts` reconciles
 * them to `db/seed/rbac.ts` on every deploy, so the edit would appear to work
 * and then silently revert.
 */

export interface RoleMutationResult<TRefusal extends string> {
  ok: boolean;
  refusals?: TRefusal[];
  /** The role no longer exists — a stale page rather than a rule. */
  gone?: boolean;
  /** Set on create, so the caller can navigate to what it made. */
  roleId?: string;
}

function afterChange() {
  revalidatePath("/admin/roles");
  // Every user page renders role badges, and the sidebar's visibility is
  // derived from permissions — so a grant change can alter what an admin sees.
  revalidatePath("/admin/users");
  revalidatePath("/admin", "layout");
}

export async function createRole(input: {
  key: string;
  name: string;
  description: string;
}): Promise<RoleMutationResult<RoleCreateRefusal>> {
  const actor = await requirePermission("role:create");

  const key = input.key.trim().toLowerCase();
  const name = input.name.trim();
  const existing = await listRoles();

  const refusals = refusalsForRoleCreate({
    key,
    name,
    existingKeys: existing.map((role) => role.key),
  });
  if (refusals.length > 0) return { ok: false, refusals };

  // Generated here rather than read back with `.returning({ … })`: the union of
  // the two drivers `getDb()` can return does not agree on that method's
  // signature, and UUID v7 is generated in application code anyway — see
  // db/any-database.ts and the same note in db/queries/exams/attempts.ts.
  const created = uuidv7();

  await getDb().transaction(async (tx) => {
    await tx.insert(roles).values({
      id: created,
      key,
      name,
      description: input.description.trim() || null,
      // Neither, and both matter. `isSystem` would make the next
      // `pnpm db:seed` try to reconcile grants it has no spec for;
      // `isProtected` would make the role undeletable by the person who just
      // created it, which is a trap rather than a safeguard.
      isSystem: false,
      isProtected: false,
    });

    await tx.insert(auditLog).values({
      actorId: actor.userId,
      action: "role.create",
      targetType: "role",
      targetId: created,
      before: null,
      after: { key, name, isSystem: false, isProtected: false },
    });
  });

  await recordActivity({
    verb: "admin.created",
    objectType: "role",
    objectId: created,
    metadata: { key },
  });

  afterChange();
  return { ok: true, roleId: created };
}

/**
 * Sets a role's grants to exactly `permissionNames`.
 *
 * The whole set, not a diff, and that is the safer shape: a diff applied to a
 * page somebody opened ten minutes ago reinstates whatever was removed in
 * between, silently. Sending the full intended state makes a concurrent edit
 * lose visibly instead.
 */
export async function setRolePermissions(input: {
  roleId: string;
  permissionNames: string[];
}): Promise<RoleMutationResult<PermissionEditRefusal>> {
  const actor = await requirePermission("role:update");

  const all = await listRoles();
  const role = all.find((candidate) => candidate.id === input.roleId);
  if (!role) return { ok: false, gone: true };

  const next = [...new Set(input.permissionNames)];
  const refusals = refusalsForPermissionEdit({
    actor,
    role: {
      key: role.key,
      permissionNames: role.permissionNames,
      isSystem: role.isSystem,
      isProtected: role.isProtected,
    },
    nextPermissionNames: next,
  });
  if (refusals.length > 0) return { ok: false, refusals };

  const db = getDb();
  const wanted =
    next.length > 0
      ? await db
          .select({ id: permissions.id, name: permissions.name })
          .from(permissions)
          .where(inArray(permissions.name, next))
      : [];

  // A name that passed `isKnownPermission` but has no row means the vocabulary
  // and the database disagree — `pnpm db:seed` has not run since the name was
  // added. Refused as unknown rather than silently granting the subset that
  // does exist, which would look like it worked.
  if (wanted.length !== next.length) {
    return { ok: false, refusals: ["unknown-permission"] };
  }

  const wantedIds = wanted.map((row) => row.id);

  await db.transaction(async (tx) => {
    if (wantedIds.length > 0) {
      await tx
        .insert(rolePermissions)
        .values(
          wantedIds.map((permissionId) => ({
            roleId: input.roleId,
            permissionId,
            grantedBy: actor.userId,
          })),
        )
        .onConflictDoNothing();
    }

    await tx
      .delete(rolePermissions)
      .where(
        wantedIds.length > 0
          ? and(
              eq(rolePermissions.roleId, input.roleId),
              notInArray(rolePermissions.permissionId, wantedIds),
            )
          : eq(rolePermissions.roleId, input.roleId),
      );

    await tx.insert(auditLog).values({
      actorId: actor.userId,
      action: "role_permission.set",
      targetType: "role_permission",
      targetId: input.roleId,
      // Both sides, sorted, so a diff can be read off the entry itself rather
      // than reconstructed by joining against whatever the table says now.
      before: { permissions: [...role.permissionNames].sort() },
      after: { permissions: [...next].sort() },
    });
  });

  await recordActivity({
    verb: "admin.updated",
    objectType: "role",
    objectId: input.roleId,
    metadata: { key: role.key, permissions: next.length },
  });

  afterChange();
  return { ok: true };
}

export async function deleteRole(input: {
  roleId: string;
}): Promise<RoleMutationResult<RoleDeleteRefusal>> {
  const actor = await requirePermission("role:delete");

  const all = await listRoles();
  const role = all.find((candidate) => candidate.id === input.roleId);
  if (!role) return { ok: false, gone: true };

  const refusals = refusalsForRoleDelete({
    role: {
      key: role.key,
      permissionNames: role.permissionNames,
      isSystem: role.isSystem,
      isProtected: role.isProtected,
    },
    // Re-read by `listRoles` on this request, not carried from the page: a role
    // that gained its first holder a minute ago must not be deletable because
    // the screen still says nobody holds it.
    holderCount: role.holderCount,
  });
  if (refusals.length > 0) return { ok: false, refusals };

  await getDb().transaction(async (tx) => {
    // `role_permissions.role_id` is CASCADE, so the grants go with it. The
    // audit entry carries them, which is the only remaining record of what the
    // role could do.
    await tx.delete(roles).where(eq(roles.id, input.roleId));

    await tx.insert(auditLog).values({
      actorId: actor.userId,
      action: "role.delete",
      targetType: "role",
      targetId: input.roleId,
      before: {
        key: role.key,
        name: role.name,
        permissions: [...role.permissionNames].sort(),
      },
      after: null,
    });
  });

  await recordActivity({
    verb: "admin.deleted",
    objectType: "role",
    objectId: input.roleId,
    metadata: { key: role.key },
  });

  afterChange();
  return { ok: true };
}
