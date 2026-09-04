import { allPermissionNames } from "@/db/seed/rbac";

/**
 * Authorization logic with no database and no Next.js runtime, so it can be
 * unit-tested directly. `lib/authz.ts` wires this to the session and the
 * connection.
 */

/**
 * What a permission check sees. `isSuperAdmin` is separate from the set on
 * purpose — see `hasPermission`.
 */
export interface PermissionContext {
  userId: string;
  permissions: ReadonlySet<string>;
  isSuperAdmin: boolean;
}

/**
 * Thrown when a permission name matches nothing in the vocabulary.
 *
 * Deliberately NOT a denial. A typo like `lesson:publsh` would otherwise deny
 * every caller and look exactly like a guard that works — the most dangerous
 * possible failure mode, because it is invisible until the day someone removes
 * the "broken" check and discovers it was the only thing standing there.
 */
export class UnknownPermissionError extends Error {
  constructor(name: string) {
    super(
      `"${name}" is not a known permission. ` +
        `Add it to db/seed/rbac.ts and docs/PERMISSIONS.md, or fix the spelling. ` +
        `An unknown permission is not treated as "deny": that would hide the typo.`,
    );
    this.name = "UnknownPermissionError";
  }
}

/** Raised when the actor is known but lacks the permission. */
export class ForbiddenError extends Error {
  constructor(readonly permission: string) {
    super(`Forbidden: ${permission}`);
    this.name = "ForbiddenError";
  }
}

/** Raised when there is no actor at all. */
export class UnauthenticatedError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "UnauthenticatedError";
  }
}

let known: Set<string> | undefined;

/**
 * The names the vocabulary defines.
 *
 * Read from the seed spec rather than from the database: this check exists to
 * catch a mistyped name in OUR code, and a name absent from the spec is a
 * mistake whether or not somebody has since created a matching row by hand.
 */
export function knownPermissionNames(): Set<string> {
  known ??= new Set(allPermissionNames());
  return known;
}

export function isKnownPermission(name: string): boolean {
  return knownPermissionNames().has(name);
}

/**
 * Does this actor hold the permission?
 *
 * A Super Admin short-circuits to `true` WITHOUT consulting the set. Their
 * power is not modelled as `role_permissions` rows, so it cannot be reduced by
 * unlinking them — a Super Admin who could be silently defanged by deleting a
 * join row is not a Super Admin.
 */
export function hasPermission(
  context: PermissionContext,
  name: string,
): boolean {
  if (!isKnownPermission(name)) throw new UnknownPermissionError(name);
  if (context.isSuperAdmin) return true;
  return context.permissions.has(name);
}

/** Every permission in `names` (AND, not OR). */
export function hasAllPermissions(
  context: PermissionContext,
  names: readonly string[],
): boolean {
  return names.every((name) => hasPermission(context, name));
}

/** At least one of `names`. */
export function hasAnyPermission(
  context: PermissionContext,
  names: readonly string[],
): boolean {
  // Mapped first, not short-circuited, so a typo in a later name still throws
  // rather than being skipped once an earlier one matches.
  const results = names.map((name) => hasPermission(context, name));
  return results.some(Boolean);
}

/**
 * Builds the context from a role/permission query result.
 *
 * The union across roles is the model: a user holding `editor` and `moderator`
 * gets both sets. There are no deny rules — an exception like "editor but
 * cannot delete" is a narrower role, because deny rules make effective
 * permissions impossible to display honestly in an admin UI.
 */
export function buildContext(
  userId: string,
  rows: readonly { permission: string | null; roleKey: string }[],
  superAdminRoleKey: string,
): PermissionContext {
  const permissions = new Set<string>();
  let isSuperAdmin = false;

  for (const row of rows) {
    if (row.roleKey === superAdminRoleKey) isSuperAdmin = true;
    if (row.permission) permissions.add(row.permission);
  }

  return { userId, permissions, isSuperAdmin };
}
