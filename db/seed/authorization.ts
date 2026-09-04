import { and, eq, inArray, notInArray } from "drizzle-orm";

import * as schema from "@/db/schema";
import { PERMISSIONS, ROLES, permissionName } from "./rbac";

/**
 * Seeds the permission vocabulary and the starting roles.
 *
 * Idempotent: upserts on the natural keys (`permissions.name`, `roles.key`) and
 * reconciles each role's grants to exactly what the spec says. Re-running
 * changes no row count.
 *
 * Deliberately does NOT delete permissions or roles that are absent from the
 * spec: the Super Admin can define both at runtime, and a deploy that silently
 * removed a role someone created — cascading its grants away with it — would be
 * a data-loss bug wearing a seed script's clothes.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

export async function seedAuthorization(tx: Tx): Promise<void> {
  // ── Permissions ───────────────────────────────────────────────────────────
  for (const spec of PERMISSIONS) {
    const row = {
      resource: spec.resource,
      action: spec.action,
      name: permissionName(spec.resource, spec.action),
      description: spec.description,
    };
    await tx
      .insert(schema.permissions)
      .values(row)
      .onConflictDoUpdate({
        target: schema.permissions.name,
        set: {
          resource: row.resource,
          action: row.action,
          description: row.description,
        },
      });
  }

  const permissionRows = await tx
    .select({ id: schema.permissions.id, name: schema.permissions.name })
    .from(schema.permissions);
  const permissionIdByName = new Map<string, string>(
    permissionRows.map((row: { id: string; name: string }) => [
      row.name,
      row.id,
    ]),
  );

  // ── Roles ─────────────────────────────────────────────────────────────────
  for (const spec of ROLES) {
    const [role] = await tx
      .insert(schema.roles)
      .values({
        key: spec.key,
        name: spec.name,
        description: spec.description,
        isSystem: spec.isSystem,
        isProtected: spec.isProtected,
      })
      .onConflictDoUpdate({
        target: schema.roles.key,
        // The key is deliberately absent: the roles_protect_system trigger
        // refuses to change it anyway, and listing it here would make every
        // re-seed look like an attempted re-key.
        set: {
          name: spec.name,
          description: spec.description,
          isSystem: spec.isSystem,
          isProtected: spec.isProtected,
        },
      })
      .returning({ id: schema.roles.id });

    // null means "everything, implicitly". The Super Admin holds NO
    // role_permissions rows on purpose: its power comes from a short-circuit in
    // `getEffectivePermissions`, so unlinking rows cannot reduce it.
    if (spec.permissions === null) continue;

    const wantedIds = spec.permissions.map((name) => {
      const id = permissionIdByName.get(name);
      if (!id) {
        // A role granting a permission that does not exist would look like it
        // worked and protect nothing.
        throw new Error(
          `role "${spec.key}" grants "${name}", which is not in the permission vocabulary`,
        );
      }
      return id;
    });

    if (wantedIds.length > 0) {
      await tx
        .insert(schema.rolePermissions)
        .values(
          wantedIds.map((permissionId) => ({
            roleId: role.id,
            permissionId,
          })),
        )
        .onConflictDoNothing();
    }

    // Reconcile: a permission removed from a seeded role's spec must actually
    // be revoked, or the role keeps power the code no longer says it has.
    await tx
      .delete(schema.rolePermissions)
      .where(
        wantedIds.length > 0
          ? and(
              eq(schema.rolePermissions.roleId, role.id),
              notInArray(schema.rolePermissions.permissionId, wantedIds),
            )
          : eq(schema.rolePermissions.roleId, role.id),
      );
  }
}

/**
 * Counts for the seed's own summary output. Kept here so the script does not
 * need to know the table names.
 */
export async function authorizationCounts(tx: Tx): Promise<{
  permissions: number;
  roles: number;
}> {
  return {
    permissions: Number(await tx.$count(schema.permissions)),
    roles: Number(await tx.$count(schema.roles)),
  };
}

/** The seeded role keys, for the verifier. */
export const SEEDED_ROLE_KEYS = ROLES.map((role) => role.key);

/** Helper for tests and the verifier: role ids by key. */
export async function roleIdsByKey(tx: Tx): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: schema.roles.id, key: schema.roles.key })
    .from(schema.roles)
    .where(inArray(schema.roles.key, SEEDED_ROLE_KEYS));
  return new Map(
    rows.map((row: { id: string; key: string }) => [row.key, row.id]),
  );
}
