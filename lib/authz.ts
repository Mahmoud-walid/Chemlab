import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import {
  permissions,
  rolePermissions,
  roles,
  userRoles,
  SUPER_ADMIN_ROLE_KEY,
} from "@/db/schema/rbac";
import {
  buildContext,
  ForbiddenError,
  hasPermission,
  UnauthenticatedError,
  type PermissionContext,
} from "@/lib/authz-core";
import { getSession } from "@/lib/session";

export {
  ForbiddenError,
  UnauthenticatedError,
  UnknownPermissionError,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  isKnownPermission,
  type PermissionContext,
} from "@/lib/authz-core";

/**
 * Server-side authorization. The single source of truth.
 *
 * Every server action and route handler that mutates data or exposes anything
 * non-public calls `requirePermission()` as its FIRST statement, and derives
 * the actor from the session — never from a user id in the request.
 *
 * UI gating (a hidden menu item, a disabled button) is convenience only. It
 * tells an honest user what they can do; it stops nobody.
 */

/**
 * One query per request, however many components ask.
 *
 * `cache()` is per-request, deliberately — NOT a TTL cache. A revoked role has
 * to take effect on the user's very next request, and a cross-request cache
 * would mean a demotion lingers for however long the TTL is. The cost is one
 * indexed join.
 *
 * The same reasoning applies to Better Auth's session cookie cache: permissions
 * are read here, per request, and are never baked into that cached snapshot —
 * otherwise a demotion would linger for the cookie-cache window.
 */
export const getPermissionContext = cache(
  async (): Promise<PermissionContext | null> => {
    const session = await getSession();
    if (!session?.user) return null;
    return loadPermissionContext(session.user.id);
  },
);

/** The uncached form, for scripts and tests that have a user id already. */
export async function loadPermissionContext(
  userId: string,
): Promise<PermissionContext> {
  const rows = await getDb()
    .select({
      roleKey: roles.key,
      permission: permissions.name,
    })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    // LEFT, not INNER: a role with no grants — `member`, or a Super Admin whose
    // power is implicit — must still return its row, or holding it would look
    // identical to holding nothing.
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, userId));

  return buildContext(userId, rows, SUPER_ADMIN_ROLE_KEY);
}

/** The permission names the signed-in user holds. Empty when signed out. */
export async function getEffectivePermissions(): Promise<ReadonlySet<string>> {
  const context = await getPermissionContext();
  return context?.permissions ?? new Set<string>();
}

/** Non-throwing check, for UI gating and for branching inside a handler. */
export async function can(name: string): Promise<boolean> {
  const context = await getPermissionContext();
  if (!context) return false;
  return hasPermission(context, name);
}

/**
 * The gate. Throws rather than returning a flag, so a caller that forgets to
 * check the result is still protected.
 *
 * Returns the context, so a handler that needs a second check does not pay for
 * a second lookup.
 */
export async function requirePermission(
  name: string,
): Promise<PermissionContext> {
  const context = await getPermissionContext();
  if (!context) throw new UnauthenticatedError();
  if (!hasPermission(context, name)) throw new ForbiddenError(name);
  return context;
}
