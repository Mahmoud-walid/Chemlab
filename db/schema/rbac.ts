import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { id, timestamps } from "./_shared";

/**
 * Authorization.
 *
 * Permissions are ROWS, not constants. The Super Admin has to be able to define
 * roles and permissions at runtime; a `role: "admin" | "user"` enum or a
 * hard-coded `PERMISSIONS` object would mean every new role is a pull request.
 *
 * The code knows how to *check* a permission. The database knows which
 * permissions exist and who holds them.
 */

export const roles = pgTable("roles", {
  id: id(),
  /** Stable machine key: `super_admin`, `editor`. Frozen on system roles. */
  key: text("key").notNull().unique(),
  /** Display label. Editable even on system roles. */
  name: text("name").notNull(),
  description: text("description"),
  /** Seeded by us; the key cannot be changed. */
  isSystem: boolean("is_system").notNull().default(false),
  /** Cannot be deleted at all. */
  isProtected: boolean("is_protected").notNull().default(false),
  ...timestamps,
});

/**
 * `resource` and `action` are separate columns with `name` as the unique key,
 * so the admin UI can group by resource and ask for "everything on lessons"
 * without parsing strings.
 */
export const permissions = pgTable(
  "permissions",
  {
    id: id(),
    resource: text("resource").notNull(),
    action: text("action").notNull(),
    /** `resource:action`, e.g. `lesson:publish`. */
    name: text("name").notNull().unique(),
    description: text("description"),
    ...timestamps,
  },
  (t) => [uniqueIndex("permissions_pair_idx").on(t.resource, t.action)],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    grantedBy: text("granted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

/**
 * A user may hold several roles; their effective permissions are the union.
 *
 * `role_id` is RESTRICT, not CASCADE: deleting a role that people still hold
 * would silently strip their access. The delete is refused instead, and the
 * caller is told how many holders there are.
 */
export const userRoles = pgTable(
  "user_roles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    assignedBy: text("assigned_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.roleId] }),
    index("user_roles_user_idx").on(t.userId),
  ],
);

/**
 * Append-only record of every authorization change.
 *
 * The Super Admin role is the highest-value target in the system, so how
 * someone came to hold it must be reconstructable after the fact. A trigger
 * refuses UPDATE and DELETE — an audit log an attacker can edit is a comfort
 * blanket, not a control.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** `role.create`, `user_role.revoke`, … */
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_log_target_idx").on(t.targetType, t.targetId, t.createdAt),
    index("audit_log_actor_idx").on(t.actorId, t.createdAt),
  ],
);

/** The key of the role that implicitly holds every permission. */
export const SUPER_ADMIN_ROLE_KEY = "super_admin";

/** The role every new signup receives, so "no privileges" is an inspectable state. */
export const DEFAULT_ROLE_KEY = "member";

export type Role = typeof roles.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
export type UserRole = typeof userRoles.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
export type NewAuditEntry = typeof auditLog.$inferInsert;
