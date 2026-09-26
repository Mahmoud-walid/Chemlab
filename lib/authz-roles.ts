import { isKnownPermission, type PermissionContext } from "@/lib/authz-core";
import { SUPER_ADMIN_ROLE_KEY } from "@/db/schema/rbac";

/**
 * Who may change whose roles, and what the database would refuse anyway.
 *
 * `role:assign` answers "may this person touch roles at all". It does not
 * answer the question that actually matters, which is **which** roles — and
 * getting that wrong is not a bug, it is a privilege-escalation hole. An Admin
 * holds `role:assign`; if that alone let them grant `super_admin`, then Admin
 * and Super Admin are the same role and the distinction in `db/seed/rbac.ts`
 * is decoration.
 *
 * Pure and free of the database on purpose, the same reasoning as
 * `authz-core.ts`: these are the rules most worth testing exhaustively, and a
 * rule that needs Postgres to exercise gets tested once and then trusted.
 *
 * Every function returns **all** the reasons, not the first one. An operator
 * who clears one refusal and is then told about the next has been made to
 * discover the rules one round trip at a time.
 */

/** The actor, as `requirePermission()` returns them. */
export type RoleActor = Pick<
  PermissionContext,
  "userId" | "permissions" | "isSuperAdmin"
>;

/** A role, reduced to what a decision here needs. */
export interface RoleFacts {
  key: string;
  /**
   * The permission names the role grants.
   *
   * Empty for `super_admin`, and that is not a special case to paper over: its
   * power is a short-circuit in `hasPermission`, not `role_permissions` rows.
   * So the escalation check below could never see it, and the `key` is what
   * decides instead.
   */
  permissionNames: readonly string[];
  /** Seeded by us. `pnpm db:seed` reconciles its grants on every deploy. */
  isSystem: boolean;
  /** Cannot be deleted at all — `super_admin` alone, today. */
  isProtected: boolean;
}

export type AssignRefusal =
  /** The role is `super_admin` and the actor is not one. */
  | "needs-super-admin"
  /** The role grants something the actor does not hold. */
  | "would-escalate"
  /** The target already holds it. */
  | "already-held";

export type RevokeRefusal =
  | "needs-super-admin"
  | "would-escalate"
  /** The target does not hold it. */
  | "not-held"
  /** The target is the actor, and losing this role costs them `role:assign`. */
  | "would-lock-out-self"
  /** The target is the only `super_admin` left. */
  | "last-super-admin";

export type PermissionEditRefusal =
  /** A seeded role: `pnpm db:seed` would put its grants back on next deploy. */
  | "system-role"
  /** The edit would grant something the actor does not hold. */
  | "would-escalate"
  /** A name that is not in the vocabulary. */
  | "unknown-permission";

export type RoleDeleteRefusal =
  | "protected"
  | "system-role"
  /** People still hold it; `user_roles.role_id` is RESTRICT. */
  | "has-holders";

export type RoleCreateRefusal =
  /** Not `lower_snake_case`. */
  | "bad-key"
  /** A role with that key exists. */
  | "key-taken"
  /** No display name. */
  | "no-name";

/**
 * Could the actor grant everything this role grants, one permission at a time?
 *
 * The rule that stops escalation by proxy. Without it, anybody with
 * `role:assign` can hand out a role more powerful than their own and then ask
 * its holder to act for them — or simply grant it to themselves.
 *
 * A Super Admin passes trivially, which is the one place the short-circuit is
 * the right answer rather than a shortcut: they already hold everything, so
 * there is nothing they could escalate to.
 */
function grantsBeyondActor(
  actor: RoleActor,
  permissionNames: readonly string[],
): boolean {
  if (actor.isSuperAdmin) return false;
  return permissionNames.some((name) => !actor.permissions.has(name));
}

/** Whether `super_admin` is in play, which only the key can say. */
function isSuperAdminRole(role: RoleFacts): boolean {
  return role.key === SUPER_ADMIN_ROLE_KEY;
}

export function refusalsForAssign({
  actor,
  role,
  targetRoleKeys,
}: {
  actor: RoleActor;
  role: RoleFacts;
  /** The role keys the target holds now. */
  targetRoleKeys: readonly string[];
}): AssignRefusal[] {
  const refusals: AssignRefusal[] = [];

  if (isSuperAdminRole(role) && !actor.isSuperAdmin) {
    refusals.push("needs-super-admin");
  }
  if (grantsBeyondActor(actor, role.permissionNames)) {
    refusals.push("would-escalate");
  }
  if (targetRoleKeys.includes(role.key)) {
    refusals.push("already-held");
  }

  return refusals;
}

export function refusalsForRevoke({
  actor,
  targetUserId,
  role,
  targetRoleKeys,
  remainingRoles,
  superAdminHolders,
}: {
  actor: RoleActor;
  targetUserId: string;
  role: RoleFacts;
  targetRoleKeys: readonly string[];
  /**
   * The roles the target would still hold afterwards, with their grants.
   *
   * Passed in rather than derived: the only question it answers is whether the
   * actor is about to remove their own ability to undo it, and that needs the
   * union of what is left, which is a database read.
   */
  remainingRoles: readonly RoleFacts[];
  /** How many accounts hold `super_admin` right now, including the target. */
  superAdminHolders: number;
}): RevokeRefusal[] {
  const refusals: RevokeRefusal[] = [];

  if (isSuperAdminRole(role) && !actor.isSuperAdmin) {
    refusals.push("needs-super-admin");
  }
  // Symmetric with assign, and not obviously so at first glance: taking a role
  // away is also an act of power over it, and somebody who could revoke what
  // they could not grant can dismantle a role they are not trusted with.
  if (grantsBeyondActor(actor, role.permissionNames)) {
    refusals.push("would-escalate");
  }
  if (!targetRoleKeys.includes(role.key)) {
    refusals.push("not-held");
  }

  if (actor.userId === targetUserId) {
    const keeps = remainingRoles.some(
      (kept) =>
        kept.key === SUPER_ADMIN_ROLE_KEY ||
        kept.permissionNames.includes("role:assign"),
    );
    // Not paternalism: without this the first thing an operator does by
    // accident is revoke their own last privileged role, and the only way back
    // is a shell on the database. The refusal names another holder as the way
    // through, which is a person, not a psql session.
    if (!keeps) refusals.push("would-lock-out-self");
  }

  if (
    isSuperAdminRole(role) &&
    targetRoleKeys.includes(role.key) &&
    superAdminHolders <= 1
  ) {
    // `user_roles_protect_last_super_admin` raises on this too. Checked here so
    // the operator reads a sentence instead of a `restrict_violation`, and
    // checked there because this layer is the one that can have a bug in it.
    refusals.push("last-super-admin");
  }

  return refusals;
}

/**
 * Whether the actor may set this role's grants to `nextPermissionNames`.
 *
 * System roles are refused outright, and that is the finding that shaped this
 * screen. `db/seed/authorization.ts` reconciles every seeded role's grants to
 * exactly what `db/seed/rbac.ts` says, and the seed runs on every deploy — so
 * an edit here would work, look like it worked, and then silently revert. A
 * control that quietly undoes itself is worse than one that is absent, because
 * the operator believes the permission was changed.
 */
export function refusalsForPermissionEdit({
  actor,
  role,
  nextPermissionNames,
}: {
  actor: RoleActor;
  role: RoleFacts;
  nextPermissionNames: readonly string[];
}): PermissionEditRefusal[] {
  const refusals: PermissionEditRefusal[] = [];

  if (role.isSystem) refusals.push("system-role");

  if (nextPermissionNames.some((name) => !isKnownPermission(name))) {
    refusals.push("unknown-permission");
  }

  // Only what is BEING ADDED is checked against the actor. Taking a permission
  // away from a role is not escalation, and refusing it would leave an Admin
  // unable to tidy up a role they can otherwise edit.
  const added = nextPermissionNames.filter(
    (name) => !role.permissionNames.includes(name),
  );
  if (grantsBeyondActor(actor, added)) refusals.push("would-escalate");

  return refusals;
}

export function refusalsForRoleDelete({
  role,
  holderCount,
}: {
  role: RoleFacts;
  holderCount: number;
}): RoleDeleteRefusal[] {
  const refusals: RoleDeleteRefusal[] = [];

  if (role.isProtected) refusals.push("protected");
  // A seeded role would be recreated by the next `pnpm db:seed` anyway, with a
  // new id — so the delete is not a delete, it is a gap until the next deploy.
  if (role.isSystem) refusals.push("system-role");
  if (holderCount > 0) refusals.push("has-holders");

  return refusals;
}

/**
 * `lower_snake_case`, starting with a letter.
 *
 * The key is what code matches on — `SUPER_ADMIN_ROLE_KEY`, the seed's
 * `onConflictDoUpdate` target — so it has to be a stable identifier rather than
 * a label. It is also frozen on system roles by a trigger, which means a typo
 * on creation is permanent for as long as anybody holds the role.
 */
export const ROLE_KEY_PATTERN = /^[a-z][a-z0-9_]{1,38}$/;

export function refusalsForRoleCreate({
  key,
  name,
  existingKeys,
}: {
  key: string;
  name: string;
  existingKeys: readonly string[];
}): RoleCreateRefusal[] {
  const refusals: RoleCreateRefusal[] = [];

  if (!ROLE_KEY_PATTERN.test(key)) refusals.push("bad-key");
  if (existingKeys.includes(key)) refusals.push("key-taken");
  if (name.trim() === "") refusals.push("no-name");

  return refusals;
}
