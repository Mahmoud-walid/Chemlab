import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import { SEEDED_ROLE_KEYS } from "@/db/seed/authorization";
import * as schema from "@/db/schema";
import { SUPER_ADMIN_ROLE_KEY } from "@/db/schema/rbac";
import { buildContext } from "@/lib/authz-core";
import {
  refusalsForAssign,
  refusalsForPermissionEdit,
  refusalsForRevoke,
  refusalsForRoleClone,
  refusalsForRoleDelete,
  refusalsForRoleRename,
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

/**
 * The SEEDED roles only, by key from the spec.
 *
 * Not "every row in `roles`", which is what this read used to be. The table may
 * legitimately hold roles somebody created at runtime — that is the entire point
 * of authorization being data — and under a shuffled run it also holds whatever
 * an earlier failing run of this very file left behind. Either way, assertions
 * about system roles must not see them: "every role in the table is a system
 * role" was a claim this file had no business making.
 */
async function loadRoles(): Promise<Map<string, SeededRole>> {
  const roles = await db
    .select({
      id: schema.roles.id,
      key: schema.roles.key,
      isSystem: schema.roles.isSystem,
      isProtected: schema.roles.isProtected,
    })
    .from(schema.roles)
    .where(inArray(schema.roles.key, [...SEEDED_ROLE_KEYS]));

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
    // informative. Scoped to the seeded keys, so a custom role created by
    // another test or by an operator cannot break it.
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

  it("gives admin the role-management permissions", () => {
    // Changed at the owner's request: Admin previously held `role:read` and
    // `role:assign` only, so every role the platform needed went through a Super
    // Admin. Asserted from the DATABASE rather than the spec, so a seed that
    // failed to reconcile the new grants fails here rather than at runtime.
    for (const permission of ["role:create", "role:update", "role:delete"]) {
      expect(byKey.get("admin")!.permissionNames, permission).toContain(
        permission,
      );
    }
  });

  it("gives admin the three permissions that were once held by no role", () => {
    // Inverted at the owner's decision. This asserted the opposite until now —
    // that `lesson:delete_hard`, `quiz:delete_hard` and
    // `notification:subscribe_ci` were held by NO role, which was the documented
    // default and the reason three e2e specs granted them for a test's duration.
    //
    // In practice that meant whoever runs the platform could not clear a spam
    // draft or see their own build alerts without a Super Admin. The
    // interruptions that make an irreversible erase deliberate are unchanged and
    // are where they belong: the typed slug in the dialog, and the server-side
    // refusals for a commented or published item.
    //
    // Read from the DATABASE, not the spec, so a seed that failed to reconcile
    // the new grants fails here rather than at runtime.
    for (const permission of [
      "lesson:delete_hard",
      "quiz:delete_hard",
      "notification:subscribe_ci",
    ]) {
      expect(byKey.get("admin")!.permissionNames, permission).toContain(
        permission,
      );
    }
  });

  it("gives them to no OTHER seeded role", () => {
    // Widening the Admin was one decision, not a general relaxation. The gate is
    // exactly as strict for everybody else, which is what the e2e specs now
    // assert against an editor.
    for (const permission of [
      "lesson:delete_hard",
      "quiz:delete_hard",
      "notification:subscribe_ci",
    ]) {
      for (const [key, role] of byKey) {
        if (key === "admin" || key === SUPER_ADMIN_ROLE_KEY) continue;
        expect(
          role.permissionNames,
          `${key} holds ${permission}`,
        ).not.toContain(permission);
      }
    }
  });

  it("still holds none of the four permissions nothing implements", () => {
    // `user:delete`, `user:impersonate`, `permission:create` and
    // `permission:delete` have no use sites in app/, lib/ or db/. Granting them
    // would put a checkbox on a role that changes nothing, and
    // `permission:create` is worse than unimplemented: `isKnownPermission` reads
    // the vocabulary from `db/seed/rbac.ts`, so a permission created at runtime
    // throws `UnknownPermissionError` the first time anything checks it.
    //
    // Asserted so the omission is a decision on the record rather than something
    // nobody got round to — and so these four stay the ceiling the clone test
    // below reaches for.
    for (const permission of [
      "user:delete",
      "user:impersonate",
      "permission:create",
      "permission:delete",
    ]) {
      expect(byKey.get("admin")!.permissionNames, permission).not.toContain(
        permission,
      );
    }
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
    // `byKey` holds only the seeded five, so this loop cannot pick up a custom
    // role and then assert that a non-system role is a system role.
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

/** A custom role this file owns, created and torn down by the block using it. */
async function makeCustomRole(): Promise<{ id: string; key: string }> {
  const id = uuidv7();
  const key = unique("custom_role").replace(/-/g, "_").toLowerCase();
  await db
    .insert(schema.roles)
    .values({ id, key, name: "Custom", isSystem: false, isProtected: false });
  return { id, key };
}

async function dropCustomRole(id: string): Promise<void> {
  await db.delete(schema.userRoles).where(eq(schema.userRoles.roleId, id));
  await db.delete(schema.roles).where(eq(schema.roles.id, id));
}

/**
 * Each test here owns its state, and that is a correction.
 *
 * The first version was four `it` blocks sharing a `roleId` that the FIRST one
 * assigned — so every other test depended on running after it. CI shuffles both
 * Vitest suites precisely to catch that, and it did: `role_id` arrived as
 * `default`, Postgres refused the NOT NULL, and the job went red while the file
 * passed locally every time in declaration order.
 *
 * CLAUDE.md §6 states the rule this broke — "if you add a test that only passes
 * in one order, the shuffle is right and the test is wrong" — so the tests are
 * what changed, not the shuffle.
 */
describe("a custom role, end to end against Postgres", () => {
  let role: { id: string; key: string };

  beforeAll(async () => {
    role = await makeCustomRole();
  });

  afterAll(async () => {
    await dropCustomRole(role.id);
  });

  it("is created as neither system nor protected", async () => {
    const [row] = await db
      .select({
        isSystem: schema.roles.isSystem,
        isProtected: schema.roles.isProtected,
      })
      .from(schema.roles)
      .where(eq(schema.roles.id, role.id));

    // Neither, and both matter: `isSystem` would make the next `pnpm db:seed`
    // reconcile grants it has no spec for, and `isProtected` would make the
    // role undeletable by whoever just created it.
    expect(row).toEqual({ isSystem: false, isProtected: false });
  });

  it("accepts a grant edit, unlike a seeded role", () => {
    expect(
      refusalsForPermissionEdit({
        actor: actorHolding(SUPER_ADMIN_ROLE_KEY),
        role: {
          key: role.key,
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
    // everything else for this role. Run against real SQL because the
    // `notInArray` half is where a wrong predicate silently keeps a grant.
    //
    // Starts by clearing, so the assertion does not depend on what any other
    // test in this file left behind.
    await db
      .delete(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, role.id));

    const wanted = ["audit:read", "activity:read"];
    const rows = await db
      .select({ id: schema.permissions.id })
      .from(schema.permissions)
      .where(inArray(schema.permissions.name, wanted));
    expect(rows).toHaveLength(2);
    const wantedIds = rows.map((row) => row.id);

    await db
      .insert(schema.rolePermissions)
      .values(
        wantedIds.map((permissionId) => ({ roleId: role.id, permissionId })),
      )
      .onConflictDoNothing();
    await db
      .delete(schema.rolePermissions)
      .where(
        and(
          eq(schema.rolePermissions.roleId, role.id),
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
      .where(eq(schema.rolePermissions.roleId, role.id));

    expect(after.map((row) => row.name).sort()).toEqual([...wanted].sort());

    // Now narrow it, which is the half that matters: the removed grant has to
    // actually go.
    const keep = [wantedIds[0]!];
    await db
      .delete(schema.rolePermissions)
      .where(
        and(
          eq(schema.rolePermissions.roleId, role.id),
          notInArray(schema.rolePermissions.permissionId, keep),
        ),
      );

    const narrowed = await db
      .select({ permissionId: schema.rolePermissions.permissionId })
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, role.id));
    expect(narrowed.map((row) => row.permissionId)).toEqual(keep);
  });

  it("cannot be deleted while somebody holds it — the FK is RESTRICT", async () => {
    // Its own role and its own holder, added and removed inside the test, so
    // nothing outside it depends on the order this runs in.
    const doomed = await makeCustomRole();
    const holder = await createUser(db, { name: "Custom role holder" });
    await db
      .insert(schema.userRoles)
      .values({ userId: holder.id, roleId: doomed.id })
      .onConflictDoNothing();

    // The rule layer refuses first, with a count the operator can act on.
    expect(
      refusalsForRoleDelete({
        role: {
          key: doomed.key,
          permissionNames: [],
          isSystem: false,
          isProtected: false,
        },
        holderCount: 1,
      }),
    ).toEqual(["has-holders"]);

    // And the database refuses the bypass. CASCADE here would silently strip
    // access from everybody holding the role, which is the failure the RESTRICT
    // exists to prevent.
    await expect(
      db.delete(schema.roles).where(eq(schema.roles.id, doomed.id)),
    ).rejects.toThrow();

    await dropCustomRole(doomed.id);
  });

  it("deletes once nobody holds it, taking its grants with it", async () => {
    const doomed = await makeCustomRole();
    const [permission] = await db
      .select({ id: schema.permissions.id })
      .from(schema.permissions)
      .where(eq(schema.permissions.name, "audit:read"));
    await db
      .insert(schema.rolePermissions)
      .values({ roleId: doomed.id, permissionId: permission!.id })
      .onConflictDoNothing();

    await db.delete(schema.roles).where(eq(schema.roles.id, doomed.id));

    const roles = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.id, doomed.id));
    expect(roles).toEqual([]);

    // `role_permissions.role_id` is CASCADE, unlike `user_roles.role_id`. The
    // asymmetry is deliberate: a grant row has no meaning without its role,
    // whereas a user_roles row is somebody's access.
    const grants = await db
      .select({ permissionId: schema.rolePermissions.permissionId })
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, doomed.id));
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

describe("an Admin's ceiling, after gaining role:create", () => {
  it("may clone any seeded role, because all of them are subsets of Admin", () => {
    // Editor, Moderator and Member are subsets by construction; Super Admin
    // holds no grant rows, so its copy is empty. Read from the database, so a
    // permission added to Editor and not Admin fails here.
    for (const key of byKey.keys()) {
      expect(
        refusalsForRoleClone({
          actor: actorHolding("admin"),
          source: byKey.get(key)!,
        }),
        key,
      ).toEqual([]);
    }
  });

  it("may not clone a role holding a permission it lacks", async () => {
    // The laundering this closes: copy the grants into a new role, and
    // `refusalsForAssign` would then permit handing it out, because by then the
    // permissions belong to the new role.
    //
    // `user:impersonate`, not `lesson:delete_hard` as it was: the Admin holds
    // that one now. It holds 49 of 53 permissions, so the ceiling is THIN — only
    // the four nothing implements sit outside it. Thin is not absent, and the
    // rule has to keep holding at whatever the boundary happens to be.
    const [held] = await db
      .select({ name: schema.permissions.name })
      .from(schema.permissions)
      .where(eq(schema.permissions.name, "user:impersonate"));
    expect(held, "the catalogue has no user:impersonate").toBeTruthy();

    expect(
      refusalsForRoleClone({
        actor: actorHolding("admin"),
        source: {
          key: "beyond_admin",
          permissionNames: [held!.name],
          isSystem: false,
          isProtected: false,
        },
      }),
    ).toEqual(["would-escalate"]);
  });

  it("may not rename a seeded role, whatever it holds", () => {
    // `roles_protect_system` permits this edit — it freezes the key only — so
    // the refusal is the service layer's alone, and the thing it prevents is the
    // next `pnpm db:seed` reverting the name with nothing reporting it.
    for (const key of byKey.keys()) {
      expect(
        refusalsForRoleRename({ role: byKey.get(key)!, name: "Renamed" }),
        key,
      ).toContain("system-role");
    }
  });

  it("can rename a role it created, and the database keeps it", async () => {
    const created = await makeCustomRole();
    try {
      expect(
        refusalsForRoleRename({
          role: {
            key: created.key,
            permissionNames: [],
            isSystem: false,
            isProtected: false,
          },
          name: "Renamed",
        }),
      ).toEqual([]);

      await db
        .update(schema.roles)
        .set({ name: "Renamed", description: "why it exists" })
        .where(eq(schema.roles.id, created.id));

      const [row] = await db
        .select({
          name: schema.roles.name,
          description: schema.roles.description,
          key: schema.roles.key,
        })
        .from(schema.roles)
        .where(eq(schema.roles.id, created.id));

      expect(row).toEqual({
        name: "Renamed",
        description: "why it exists",
        // The key is untouched by a rename, which is the whole point of it being
        // a separate column from the label.
        key: created.key,
      });
    } finally {
      await dropCustomRole(created.id);
    }
  });
});
