import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { SUPER_ADMIN_ROLE_KEY } from "@/db/schema/rbac";
import { buildContext } from "@/lib/authz-core";
import {
  refusalsForAssign,
  refusalsForPermissionEdit,
  refusalsForRevoke,
  refusalsForRoleDelete,
  type RoleFacts,
} from "@/lib/authz-roles";
import { listRoles } from "@/db/queries/admin/roles";
import { createUser } from "../factories";
import { unique } from "../factories/ids";

/**
 * The role rules, against the roles that actually exist.
 *
 * `tests/lib/authz-roles.test.ts` proves the logic exhaustively against
 * fixtures. Fixtures are where a rule can be right about a role nobody has —
 * so this file loads the SEEDED roles out of Postgres and asks the same
 * questions about them. The interesting answers are the ones about `admin`,
 * because that is the role a real operator holds and the one an escalation
 * would come from.
 *
 * It also proves the two things only the database can answer: that the FK on
 * `user_roles.role_id` is RESTRICT rather than CASCADE, and that the grant
 * reconciliation `setRolePermissions` performs leaves exactly the intended set.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

interface SeededRole extends RoleFacts {
  id: string;
}

let byKey: Map<string, SeededRole>;

async function loadRoles(): Promise<Map<string, SeededRole>> {
  const roles = await db
    .select({
      id: schema.roles.id,
      key: schema.roles.key,
      isSystem: schema.roles.isSystem,
      isProtected: schema.roles.isProtected,
    })
    .from(schema.roles);

  const grants = await db
    .select({
      roleId: schema.rolePermissions.roleId,
      name: schema.permissions.name,
    })
    .from(schema.rolePermissions)
    .innerJoin(
      schema.permissions,
      eq(schema.permissions.id, schema.rolePermissions.permissionId),
    );

  return new Map(
    roles.map((role) => [
      role.key,
      {
        ...role,
        permissionNames: grants
          .filter((grant) => grant.roleId === role.id)
          .map((grant) => grant.name)
          .sort(),
      },
    ]),
  );
}

/** An actor holding exactly what the named seeded role grants. */
function actorHolding(roleKey: string, userId = "actor") {
  const role = byKey.get(roleKey)!;
  return buildContext(
    userId,
    role.permissionNames.length > 0
      ? role.permissionNames.map((permission) => ({
          permission,
          roleKey,
        }))
      : [{ permission: null, roleKey }],
    SUPER_ADMIN_ROLE_KEY,
  );
}

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));
  byKey = await loadRoles();
});

afterAll(async () => {
  await close?.();
});

describe("the seeded roles are what the rules were written against", () => {
  it("finds all five", () => {
    // Without this the assertions below would pass vacuously on an unseeded
    // database — `byKey.get("admin")!` on an empty map throws somewhere less
    // informative.
    expect([...byKey.keys()].sort()).toEqual([
      "admin",
      "editor",
      "member",
      "moderator",
      "super_admin",
    ]);
  });

  it("gives super_admin no grant rows, so the key is what decides", () => {
    // If this ever gains rows, `refusalsForAssign` would start reasoning about
    // its permission set instead of its key — and the set would be incomplete.
    expect(byKey.get(SUPER_ADMIN_ROLE_KEY)!.permissionNames).toEqual([]);
    expect(byKey.get(SUPER_ADMIN_ROLE_KEY)!.isProtected).toBe(true);
  });

  it("gives admin role:assign, which is what makes the rest of this file matter", () => {
    expect(byKey.get("admin")!.permissionNames).toContain("role:assign");
  });
});

describe("listRoles, the query the screens actually render from", () => {
  /**
   * This is here because the first version of that query returned zero grants
   * for every role and said nothing.
   *
   * It used a correlated subquery, and Drizzle renders a column unqualified
   * inside a `sql` template when the outer query has no join — so
   * `where rp.role_id = "id"` bound to `permissions.id`, which is in scope
   * there, and matched nothing. Super Admin rendering as "No grants" is
   * indistinguishable from Super Admin correctly holding no grant rows, which
   * is why nothing looked wrong.
   *
   * The fixture-based unit tests could not catch it and the rule tests above
   * could not either: both build their own role facts. Only a test that calls
   * the real query can.
   */
  it("returns the grants each seeded role actually has", async () => {
    const rows = await listRoles();
    const found = new Map(rows.map((row) => [row.key, row]));

    // Compared against the join this file loads independently, so the
    // assertion is not a hard-coded count that drifts when a permission is
    // added to `db/seed/rbac.ts`.
    for (const [key, expected] of byKey) {
      expect(found.get(key)?.permissionNames.length, key).toBe(
        expected.permissionNames.length,
      );
    }

    // And at least one role has to be non-empty, or the loop above passes on a
    // query that returns nothing at all — which is exactly what it did.
    expect(found.get("admin")!.permissionNames.length).toBeGreaterThan(20);
    expect(found.get("editor")!.permissionNames.length).toBeGreaterThan(5);
  });

  it("counts holders per role rather than reporting zero for all of them", async () => {
    const rows = await listRoles();
    const superAdmin = rows.find((row) => row.key === SUPER_ADMIN_ROLE_KEY)!;

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.userRoles)
      .where(eq(schema.userRoles.roleId, superAdmin.id));

    expect(superAdmin.holderCount).toBe(total);
  });
});

describe("what a real Admin may grant", () => {
  it("cannot grant super_admin", () => {
    // The escalation, against the real role. An Admin holds `role:assign`; if
    // that were the whole check, Admin and Super Admin would be one role.
    expect(
      refusalsForAssign({
        actor: actorHolding("admin"),
        role: byKey.get(SUPER_ADMIN_ROLE_KEY)!,
        targetRoleKeys: [],
      }),
    ).toEqual(["needs-super-admin"]);
  });

  it("can grant editor, moderator and member", () => {
    // These three are subsets of what Admin holds — asserted here rather than
    // assumed, because `db/seed/rbac.ts` is edited by hand and a permission
    // added to Editor but not Admin would silently stop Admins staffing it.
    for (const key of ["editor", "moderator", "member"]) {
      expect(
        refusalsForAssign({
          actor: actorHolding("admin"),
          role: byKey.get(key)!,
          targetRoleKeys: [],
        }),
        key,
      ).toEqual([]);
    }
  });

  it("can grant admin, which it holds itself", () => {
    expect(
      refusalsForAssign({
        actor: actorHolding("admin"),
        role: byKey.get("admin")!,
        targetRoleKeys: [],
      }),
    ).toEqual([]);
  });
});

describe("what a real Editor and Moderator may grant", () => {
  it("nothing, because neither holds role:assign at all", () => {
    // The gate stops them before these rules run. Asserted anyway: if a future
    // edit gives Editor `role:assign`, this is the test that says what that
    // would then mean.
    for (const key of ["editor", "moderator"]) {
      expect(byKey.get(key)!.permissionNames, key).not.toContain("role:assign");
    }
  });

  it("and an Editor could not grant admin even if it did", () => {
    expect(
      refusalsForAssign({
        actor: actorHolding("editor"),
        role: byKey.get("admin")!,
        targetRoleKeys: [],
      }),
    ).toEqual(["would-escalate"]);
  });
});

describe("editing a seeded role's grants", () => {
  it("is refused for every one of them, Super Admin included", () => {
    // `db/seed/authorization.ts` reconciles each seeded role's grants on every
    // deploy. An edit here would work, look like it worked, and revert.
    for (const key of byKey.keys()) {
      expect(
        refusalsForPermissionEdit({
          actor: actorHolding(SUPER_ADMIN_ROLE_KEY),
          role: byKey.get(key)!,
          nextPermissionNames: ["lesson:read"],
        }),
        key,
      ).toContain("system-role");
    }
  });
});

describe("a custom role, end to end against Postgres", () => {
  const key = unique("custom_role").replace(/-/g, "_").toLowerCase();
  let roleId: string;

  it("can be created, and is neither system nor protected", async () => {
    roleId = uuidv7();
    await db.insert(schema.roles).values({
      id: roleId,
      key,
      name: "Custom",
      isSystem: false,
      isProtected: false,
    });

    const [row] = await db
      .select({
        isSystem: schema.roles.isSystem,
        isProtected: schema.roles.isProtected,
      })
      .from(schema.roles)
      .where(eq(schema.roles.id, roleId));

    expect(row).toEqual({ isSystem: false, isProtected: false });
  });

  it("accepts a grant edit, unlike a seeded role", () => {
    expect(
      refusalsForPermissionEdit({
        actor: actorHolding(SUPER_ADMIN_ROLE_KEY),
        role: {
          key,
          permissionNames: [],
          isSystem: false,
          isProtected: false,
        },
        nextPermissionNames: ["audit:read", "activity:read"],
      }),
    ).toEqual([]);
  });

  it("reconciles its grants to exactly the intended set", async () => {
    // The shape `setRolePermissions` uses: insert the wanted ones, delete
    // everything else for this role. Run here against real SQL because the
    // `notInArray` half is where a wrong predicate silently keeps a grant.
    const wanted = ["audit:read", "activity:read"];
    const rows = await db
      .select({ id: schema.permissions.id })
      .from(schema.permissions)
      .where(inArray(schema.permissions.name, wanted));
    expect(rows).toHaveLength(2);
    const wantedIds = rows.map((row) => row.id);

    await db
      .insert(schema.rolePermissions)
      .values(wantedIds.map((permissionId) => ({ roleId, permissionId })))
      .onConflictDoNothing();
    await db
      .delete(schema.rolePermissions)
      .where(
        and(
          eq(schema.rolePermissions.roleId, roleId),
          notInArray(schema.rolePermissions.permissionId, wantedIds),
        ),
      );

    const after = await db
      .select({ name: schema.permissions.name })
      .from(schema.rolePermissions)
      .innerJoin(
        schema.permissions,
        eq(schema.permissions.id, schema.rolePermissions.permissionId),
      )
      .where(eq(schema.rolePermissions.roleId, roleId));

    expect(after.map((row) => row.name).sort()).toEqual([...wanted].sort());

    // Now narrow it, which is the half that matters: the removed grant has to
    // actually go.
    const keep = [wantedIds[0]!];
    await db
      .delete(schema.rolePermissions)
      .where(
        and(
          eq(schema.rolePermissions.roleId, roleId),
          notInArray(schema.rolePermissions.permissionId, keep),
        ),
      );

    const narrowed = await db
      .select({ permissionId: schema.rolePermissions.permissionId })
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, roleId));
    expect(narrowed.map((row) => row.permissionId)).toEqual(keep);
  });

  it("cannot be deleted while somebody holds it — the FK is RESTRICT", async () => {
    const holder = await createUser(db, { name: "Custom role holder" });
    await db
      .insert(schema.userRoles)
      .values({ userId: holder.id, roleId })
      .onConflictDoNothing();

    // The rule layer refuses first, with a count the operator can act on.
    expect(
      refusalsForRoleDelete({
        role: { key, permissionNames: [], isSystem: false, isProtected: false },
        holderCount: 1,
      }),
    ).toEqual(["has-holders"]);

    // And the database refuses the bypass. CASCADE here would silently strip
    // access from everybody holding the role, which is the failure the
    // RESTRICT exists to prevent.
    await expect(
      db.delete(schema.roles).where(eq(schema.roles.id, roleId)),
    ).rejects.toThrow();

    await db
      .delete(schema.userRoles)
      .where(
        and(
          eq(schema.userRoles.userId, holder.id),
          eq(schema.userRoles.roleId, roleId),
        ),
      );
  });

  it("deletes once nobody holds it, taking its grants with it", async () => {
    await db.delete(schema.roles).where(eq(schema.roles.id, roleId));

    const roles = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.id, roleId));
    expect(roles).toEqual([]);

    // `role_permissions.role_id` is CASCADE, unlike `user_roles.role_id`. The
    // asymmetry is deliberate: a grant row has no meaning without its role,
    // whereas a user_roles row is somebody's access.
    const grants = await db
      .select({ permissionId: schema.rolePermissions.permissionId })
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, roleId));
    expect(grants).toEqual([]);
  });
});

describe("revoking, with the real super_admin role", () => {
  it("refuses the last holder", async () => {
    const holders = await db
      .select({ userId: schema.userRoles.userId })
      .from(schema.userRoles)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
      .where(eq(schema.roles.key, SUPER_ADMIN_ROLE_KEY));

    expect(
      refusalsForRevoke({
        actor: actorHolding(SUPER_ADMIN_ROLE_KEY, "holder"),
        targetUserId: "holder",
        role: byKey.get(SUPER_ADMIN_ROLE_KEY)!,
        targetRoleKeys: [SUPER_ADMIN_ROLE_KEY],
        remainingRoles: [],
        // Deliberately 1 rather than `holders.length`: the assertion is about
        // the rule, and the seeded database may have any number of holders.
        superAdminHolders: 1,
      }),
    ).toContain("last-super-admin");

    // The count is read so the query shape is exercised too, not just asserted
    // on a literal.
    expect(Array.isArray(holders)).toBe(true);
  });
});
