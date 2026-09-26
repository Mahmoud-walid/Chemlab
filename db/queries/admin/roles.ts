import "server-only";
import { asc, eq, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { profiles, users } from "@/db/schema/auth";
import {
  permissions,
  rolePermissions,
  roles,
  userRoles,
  SUPER_ADMIN_ROLE_KEY,
} from "@/db/schema/rbac";

/**
 * Roles and the permission vocabulary, for the admin panel.
 *
 * Read from the DATABASE, not from `db/seed/rbac.ts`. The seed is where the
 * system roles are declared, but authorization here is data: a Super Admin can
 * create a role at runtime, and a screen rendered from the spec would not show
 * it — which is the same as the screen lying about who can do what.
 *
 * `lib/authz-core.ts` reads the spec instead, and deliberately: it is checking
 * for a mistyped permission name in OUR code, and a name absent from the spec
 * is a mistake whether or not a matching row exists.
 */

export interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isProtected: boolean;
  /** How many accounts hold it. Needed before any delete — the FK is RESTRICT. */
  holderCount: number;
  /**
   * The permission names it grants, sorted.
   *
   * Empty for `super_admin`, which holds no grant rows on purpose — its power
   * is a short-circuit in `hasPermission`. The UI has to say so rather than
   * rendering an empty list, or the most powerful role looks like the weakest.
   */
  permissionNames: string[];
}

/**
 * Every role, with its grants and its holder count.
 *
 * Three queries assembled in TypeScript rather than one with correlated
 * subqueries, and that is a correction rather than a style choice. The
 * subquery form was written first and returned **zero grants for every role**,
 * silently:
 *
 * Drizzle renders a column unqualified inside a `sql` template when the outer
 * query has no join — `${roles.id}` becomes bare `"id"` — and inside
 * `select … from role_permissions rp join permissions p …` there IS an `id` in
 * scope, `p.id`. So `where rp.role_id = "id"` compared a grant's role against
 * the permission's own id and matched nothing. No error, no warning: the most
 * powerful role in the system rendered as "No grants".
 *
 * CLAUDE.md §10 records the unqualified-column trap. What it does not say, and
 * what cost the time here, is that the behaviour is JOIN-DEPENDENT: the same
 * template in `db/queries/admin/users.ts` is correct only because that query
 * has a `leftJoin`, which makes Drizzle qualify. Relying on that is relying on
 * a join staying in a query for reasons unrelated to this subquery.
 *
 * Three small reads over a handful of rows cannot acquire that failure mode.
 */
export async function listRoles(): Promise<RoleRow[]> {
  const db = getDb();

  const [roleRows, grantRows, holderRows] = await Promise.all([
    db
      .select({
        id: roles.id,
        key: roles.key,
        name: roles.name,
        description: roles.description,
        isSystem: roles.isSystem,
        isProtected: roles.isProtected,
      })
      .from(roles)
      // Alphabetical by display name, not by physical row order: the key is an
      // identifier and the name is what the reader is scanning. Untested on
      // purpose — for the seeded roles both orderings are the same sequence, so
      // an assertion here would pass against either and prove nothing.
      .orderBy(asc(roles.name)),

    db
      .select({
        roleId: rolePermissions.roleId,
        name: permissions.name,
      })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .orderBy(asc(permissions.name)),

    db
      .select({
        roleId: userRoles.roleId,
        total: sql<number>`count(*)::int`,
      })
      .from(userRoles)
      .groupBy(userRoles.roleId),
  ]);

  const grantsByRole = new Map<string, string[]>();
  for (const grant of grantRows) {
    const list = grantsByRole.get(grant.roleId);
    if (list) list.push(grant.name);
    else grantsByRole.set(grant.roleId, [grant.name]);
  }

  const holdersByRole = new Map(
    holderRows.map((row) => [row.roleId, row.total]),
  );

  return roleRows.map((role) => ({
    ...role,
    holderCount: holdersByRole.get(role.id) ?? 0,
    permissionNames: grantsByRole.get(role.id) ?? [],
  }));
}

export interface RoleHolder {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface RoleDetail extends RoleRow {
  holders: RoleHolder[];
}

/** One role by id, with the people who hold it. Null when the id matches nothing. */
export async function getRoleById(id: string): Promise<RoleDetail | null> {
  const all = await listRoles();
  const role = all.find((candidate) => candidate.id === id);
  if (!role) return null;

  const holders = await getDb()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: profiles.avatarUrl,
    })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(userRoles.roleId, id))
    .orderBy(asc(users.name));

  return { ...role, holders };
}

export interface PermissionRow {
  name: string;
  resource: string;
  action: string;
  description: string | null;
}

export interface PermissionGroup {
  resource: string;
  permissions: PermissionRow[];
}

/**
 * The vocabulary, grouped by resource.
 *
 * Grouped here rather than in the component because `resource` and `action` are
 * separate columns for exactly this — the schema comment says so — and parsing
 * `name` back apart in the UI would make the split pointless.
 */
export async function listPermissionGroups(): Promise<PermissionGroup[]> {
  const rows = await getDb()
    .select({
      name: permissions.name,
      resource: permissions.resource,
      action: permissions.action,
      description: permissions.description,
    })
    .from(permissions)
    .orderBy(asc(permissions.resource), asc(permissions.action));

  const groups: PermissionGroup[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last?.resource === row.resource) last.permissions.push(row);
    else groups.push({ resource: row.resource, permissions: [row] });
  }
  return groups;
}

/**
 * How many accounts hold `super_admin`.
 *
 * Its own query because the answer decides whether a revoke is refused, and a
 * count taken from a list the page rendered earlier can be stale by the time
 * the action runs. The action re-reads it.
 */
export async function countSuperAdminHolders(): Promise<number> {
  const [row] = await getDb()
    .select({ total: sql<number>`count(*)::int` })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(roles.key, SUPER_ADMIN_ROLE_KEY));

  return row?.total ?? 0;
}
