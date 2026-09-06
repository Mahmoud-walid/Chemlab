import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, ne } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { SUPER_ADMIN_ROLE_KEY } from "@/db/schema/rbac";
import { buildContext, hasPermission } from "@/lib/authz-core";

/**
 * Authorization against real Postgres.
 *
 * The triggers are the point of this file. A service-layer check can be
 * bypassed by a bug, a script, or a psql session; these assertions run the
 * bypass and prove the database still refuses.
 */

let db: SeedDatabase;
let close: () => Promise<void>;
let roleIds: Map<string, string>;
let baseSuperAdminId: string;

const BASE_SUPER_ADMIN_EMAIL = "base-super@rbac-test.invalid";

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  const rows = await db
    .select({ id: schema.roles.id, key: schema.roles.key })
    .from(schema.roles);
  roleIds = new Map(rows.map((row) => [row.key, row.id]));

  /**
   * A stable Super Admin the suite owns.
   *
   * "At least one Super Admin must exist" is a GLOBAL invariant, so a test that
   * adds a holder and then removes it only works when somebody else already
   * holds it. On a fresh database nobody does — which is exactly how CI differs
   * from a developer machine that has run `db:bootstrap-admin`, and how the
   * first version of this file passed locally and failed in CI.
   *
   * Fixed address, upserted, so repeated runs reuse the same row.
   */
  baseSuperAdminId = uuidv7();
  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, BASE_SUPER_ADMIN_EMAIL))
    .limit(1);

  if (existing) {
    baseSuperAdminId = existing.id;
  } else {
    await db.insert(schema.users).values({
      id: baseSuperAdminId,
      name: "Base Super Admin",
      email: BASE_SUPER_ADMIN_EMAIL,
      emailVerified: false,
    });
  }

  await db
    .insert(schema.userRoles)
    .values({
      userId: baseSuperAdminId,
      roleId: roleIds.get(SUPER_ADMIN_ROLE_KEY)!,
    })
    .onConflictDoNothing();
});

afterAll(async () => {
  await close?.();
});

let created: string[] = [];

async function makeUser(email: string): Promise<string> {
  const id = uuidv7();
  await db.insert(schema.users).values({
    id,
    name: email.split("@")[0]!,
    email,
    emailVerified: false,
  });
  created.push(id);
  return id;
}

async function grant(userId: string, roleKey: string) {
  await db
    .insert(schema.userRoles)
    .values({ userId, roleId: roleIds.get(roleKey)! })
    .onConflictDoNothing();
}

/** The same query lib/authz.ts runs, without the Next.js runtime around it. */
async function permissionsOf(userId: string) {
  const rows = await db
    .select({ roleKey: schema.roles.key, permission: schema.permissions.name })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .leftJoin(
      schema.rolePermissions,
      eq(schema.rolePermissions.roleId, schema.roles.id),
    )
    .leftJoin(
      schema.permissions,
      eq(schema.permissions.id, schema.rolePermissions.permissionId),
    )
    .where(eq(schema.userRoles.userId, userId));

  return buildContext(userId, rows, SUPER_ADMIN_ROLE_KEY);
}

beforeEach(() => {
  created = [];
});

/**
 * Asserts that a query is refused, matching the DATABASE's message.
 *
 * Drizzle wraps a failed query in its own Error whose message is just the SQL,
 * so a plain `.rejects.toThrow(/append-only/)` passes for any failure at all —
 * including a typo in the query. The Postgres message is on the cause chain,
 * and that is what these tests are actually about.
 */
async function expectRefused(
  run: () => Promise<unknown>,
  pattern: RegExp,
): Promise<void> {
  let thrown: unknown;
  try {
    await run();
  } catch (error) {
    thrown = error;
  }

  expect(thrown, "expected the database to refuse this").toBeDefined();

  const messages: string[] = [];
  for (
    let error: unknown = thrown;
    error instanceof Error;
    error = error.cause
  ) {
    messages.push(error.message);
  }

  expect(messages.join("\n")).toMatch(pattern);
}

describe("the seeded vocabulary", () => {
  it("creates the five starting roles", async () => {
    for (const key of [
      "super_admin",
      "admin",
      "editor",
      "moderator",
      "member",
    ]) {
      expect(roleIds.get(key), key).toBeTruthy();
    }
  });

  it("gives the Super Admin no role_permissions rows at all", async () => {
    // Its power must not be reducible by unlinking rows.
    const grants = await db
      .select()
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, roleIds.get("super_admin")!));
    expect(grants).toEqual([]);
  });

  it("gives the member role no admin permissions", async () => {
    const grants = await db
      .select()
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, roleIds.get("member")!));
    expect(grants).toEqual([]);
  });
});

describe("effective permissions", () => {
  it("unions across several roles, and loses only the revoked one", async () => {
    const userId = await makeUser(`union-${Date.now()}@rbac-test.invalid`);
    await grant(userId, "editor");
    await grant(userId, "moderator");

    let context = await permissionsOf(userId);
    expect(hasPermission(context, "lesson:publish")).toBe(true);
    expect(hasPermission(context, "comment:moderate")).toBe(true);

    await db
      .delete(schema.userRoles)
      .where(
        and(
          eq(schema.userRoles.userId, userId),
          eq(schema.userRoles.roleId, roleIds.get("moderator")!),
        ),
      );

    context = await permissionsOf(userId);
    // The other role's permissions survive.
    expect(hasPermission(context, "lesson:publish")).toBe(true);
    expect(hasPermission(context, "comment:moderate")).toBe(false);
  });

  it("revokes immediately — the very next read, no cache to wait for", async () => {
    const userId = await makeUser(`revoke-${Date.now()}@rbac-test.invalid`);
    await grant(userId, "editor");
    expect(hasPermission(await permissionsOf(userId), "lesson:publish")).toBe(
      true,
    );

    await db
      .delete(schema.userRoles)
      .where(eq(schema.userRoles.userId, userId));

    expect(hasPermission(await permissionsOf(userId), "lesson:publish")).toBe(
      false,
    );
  });

  it("grants immediately too", async () => {
    const userId = await makeUser(`grant-${Date.now()}@rbac-test.invalid`);
    await grant(userId, "member");
    expect(hasPermission(await permissionsOf(userId), "lesson:publish")).toBe(
      false,
    );

    await grant(userId, "editor");
    expect(hasPermission(await permissionsOf(userId), "lesson:publish")).toBe(
      true,
    );
  });

  it("follows a permission removed from a role the user holds", async () => {
    // Not just role changes: editing the ROLE must move everyone holding it.
    const userId = await makeUser(`rolemod-${Date.now()}@rbac-test.invalid`);
    await grant(userId, "moderator");
    expect(hasPermission(await permissionsOf(userId), "comment:moderate")).toBe(
      true,
    );

    const [permission] = await db
      .select({ id: schema.permissions.id })
      .from(schema.permissions)
      .where(eq(schema.permissions.name, "comment:moderate"));

    await db
      .delete(schema.rolePermissions)
      .where(
        and(
          eq(schema.rolePermissions.roleId, roleIds.get("moderator")!),
          eq(schema.rolePermissions.permissionId, permission!.id),
        ),
      );

    expect(hasPermission(await permissionsOf(userId), "comment:moderate")).toBe(
      false,
    );

    // Put it back, so the seeded state is what the next test sees.
    await db
      .insert(schema.rolePermissions)
      .values({
        roleId: roleIds.get("moderator")!,
        permissionId: permission!.id,
      })
      .onConflictDoNothing();
  });

  it("gives a Super Admin everything without any grant rows", async () => {
    const userId = await makeUser(`super-${Date.now()}@rbac-test.invalid`);
    await grant(userId, SUPER_ADMIN_ROLE_KEY);

    const context = await permissionsOf(userId);
    expect(context.isSuperAdmin).toBe(true);
    expect(context.permissions.size).toBe(0);
    expect(hasPermission(context, "role:assign")).toBe(true);
    expect(hasPermission(context, "user:impersonate")).toBe(true);

    // Safe because the base holder remains: revoke first, then remove the user.
    // Deleting the user directly would cascade into user_roles and be refused
    // if this happened to be the only Super Admin.
    await db
      .delete(schema.userRoles)
      .where(eq(schema.userRoles.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });
});

describe("the last Super Admin", () => {
  /**
   * Runs `attempt` with the base holder as the ONLY Super Admin, and expects
   * the database to refuse it.
   *
   * The reduction to one holder happens inside a transaction, and the refusal
   * itself aborts that transaction — so every other holder is restored by the
   * rollback. Mutating the holder set for real would make the suite depend on
   * its own execution order, and would delete a genuine Super Admin on a
   * developer's machine.
   */
  async function expectRefusedAsLastSuperAdmin(
    attempt: (tx: SeedDatabase) => Promise<unknown>,
    pattern: RegExp,
  ) {
    await expectRefused(
      () =>
        db.transaction(async (tx) => {
          // Each of these leaves the base holder behind, so none is refused.
          await tx
            .delete(schema.userRoles)
            .where(
              and(
                eq(schema.userRoles.roleId, roleIds.get(SUPER_ADMIN_ROLE_KEY)!),
                ne(schema.userRoles.userId, baseSuperAdminId),
              ),
            );

          const holders = await tx
            .select({ userId: schema.userRoles.userId })
            .from(schema.userRoles)
            .where(
              eq(schema.userRoles.roleId, roleIds.get(SUPER_ADMIN_ROLE_KEY)!),
            );
          expect(holders.length, "expected exactly one holder").toBe(1);

          // Must be refused. The throw rolls the whole transaction back.
          await attempt(tx as unknown as SeedDatabase);
        }),
      pattern,
    );
  }

  it("cannot have their role revoked", async () => {
    await expectRefusedAsLastSuperAdmin(
      (tx) =>
        tx
          .delete(schema.userRoles)
          .where(eq(schema.userRoles.userId, baseSuperAdminId)),
      /last super_admin/i,
    );
  });

  it("cannot be deleted, because the cascade hits the same trigger", async () => {
    await expectRefusedAsLastSuperAdmin(
      (tx) =>
        tx.delete(schema.users).where(eq(schema.users.id, baseSuperAdminId)),
      /last super_admin/i,
    );
  });

  it("cannot have their row re-pointed at another role", async () => {
    // A revocation in disguise.
    await expectRefusedAsLastSuperAdmin(
      (tx) =>
        tx
          .update(schema.userRoles)
          .set({ roleId: roleIds.get("member")! })
          .where(
            and(
              eq(schema.userRoles.userId, baseSuperAdminId),
              eq(schema.userRoles.roleId, roleIds.get(SUPER_ADMIN_ROLE_KEY)!),
            ),
          ),
      /last super_admin/i,
    );
  });

  it("becomes removable once another holder exists", async () => {
    const countHolders = async () =>
      (
        await db
          .select({ userId: schema.userRoles.userId })
          .from(schema.userRoles)
          .where(
            eq(schema.userRoles.roleId, roleIds.get(SUPER_ADMIN_ROLE_KEY)!),
          )
      ).length;

    // Relative to whatever the database already had, never an absolute count:
    // other suites and the e2e run create Super Admins too, and a test that
    // assumes it owns the holder set is the bug this file already fixed once.
    const before = await countHolders();

    const second = await makeUser(
      `second-super-${Date.now()}@rbac-test.invalid`,
    );
    await grant(second, SUPER_ADMIN_ROLE_KEY);
    expect(await countHolders()).toBe(before + 1);

    // With two holders, removing one is allowed.
    await db
      .delete(schema.userRoles)
      .where(
        and(
          eq(schema.userRoles.userId, second),
          eq(schema.userRoles.roleId, roleIds.get(SUPER_ADMIN_ROLE_KEY)!),
        ),
      );

    expect(await countHolders()).toBe(before);

    await db.delete(schema.users).where(eq(schema.users.id, second));
  });
});

describe("protected roles", () => {
  it("cannot be deleted or re-keyed, and cannot have their protection removed", async () => {
    await expectRefused(
      () =>
        db
          .delete(schema.roles)
          .where(eq(schema.roles.key, SUPER_ADMIN_ROLE_KEY)),
      /protected/i,
    );

    await expectRefused(
      () =>
        db
          .update(schema.roles)
          .set({ key: "sa" })
          .where(eq(schema.roles.key, SUPER_ADMIN_ROLE_KEY)),
      /re-keyed/i,
    );

    // Otherwise "unprotect, then delete" is a two-step bypass.
    await expectRefused(
      () =>
        db
          .update(schema.roles)
          .set({ isProtected: false })
          .where(eq(schema.roles.key, SUPER_ADMIN_ROLE_KEY)),
      /protection/i,
    );
  });

  it("still allows the display name to be edited", async () => {
    // Freezing the label would make the roles table feel broken for no gain:
    // code matches on the key, not the name.
    await db
      .update(schema.roles)
      .set({ name: "Owner" })
      .where(eq(schema.roles.key, SUPER_ADMIN_ROLE_KEY));

    const [role] = await db
      .select({ name: schema.roles.name })
      .from(schema.roles)
      .where(eq(schema.roles.key, SUPER_ADMIN_ROLE_KEY));
    expect(role?.name).toBe("Owner");

    await db
      .update(schema.roles)
      .set({ name: "Super Admin" })
      .where(eq(schema.roles.key, SUPER_ADMIN_ROLE_KEY));
  });

  it("refuses to delete a role that someone still holds", async () => {
    // RESTRICT, not CASCADE: deleting a role in use would silently strip the
    // holders' access.
    const userId = await makeUser(`holder-${Date.now()}@rbac-test.invalid`);
    await grant(userId, "editor");

    await expectRefused(
      () => db.delete(schema.roles).where(eq(schema.roles.key, "editor")),
      /./,
    );

    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });
});

describe("the audit log", () => {
  it("accepts inserts", async () => {
    await db.insert(schema.auditLog).values({
      actorId: null,
      action: "role.update",
      targetType: "role",
      targetId: roleIds.get("editor")!,
      before: { name: "Editor" },
      after: { name: "Editor" },
    });

    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "role.update"));
    expect(rows.length).toBeGreaterThan(0);
  });

  it("refuses updates and deletes", async () => {
    // A row of its own to aim at. The trigger fires per ROW, so an UPDATE
    // matching nothing raises nothing — and this test used to rely on some
    // earlier test having left a `role.update` entry behind, which made it
    // pass only in the orders where one had. Inserting is allowed; it is
    // rewriting that the log refuses, which is the claim.
    await db.insert(schema.auditLog).values({
      action: "role.update",
      targetType: "role",
      targetId: `append-only-probe-${uuidv7()}`,
      before: null,
      after: null,
    });

    // An audit log the application can rewrite records only what an attacker
    // was willing to leave behind.
    await expectRefused(
      () =>
        db
          .update(schema.auditLog)
          .set({ action: "tampered" })
          .where(eq(schema.auditLog.action, "role.update")),
      /append-only/i,
    );

    await expectRefused(
      () =>
        db
          .delete(schema.auditLog)
          .where(eq(schema.auditLog.action, "role.update")),
      /append-only/i,
    );
  });

  /**
   * Q40, resolved: an account that has audited something CAN now be deleted,
   * and the log survives it.
   *
   * `audit_log.actor_id` is `ON DELETE SET NULL`, and the trigger used to
   * refuse every UPDATE — so the delete failed with a message about the audit
   * log from a screen about a user. Both rules were wanted; together they
   * contradicted each other.
   *
   * The trigger now permits exactly one thing more: `actor_id` from a value to
   * NULL, with every other column identical. Nulling the author of an entry is
   * not rewriting what the entry says — and the tests below are the boundary,
   * because "widened by exactly one case" is a claim that needs holding down.
   */
  describe("anonymising an actor", () => {
    /** A user with one audit entry to their name. Returns both ids. */
    async function actorWithEntry() {
      // `makeUser` records the id in `created`, whose cleanup deletes it —
      // harmlessly, since these tests delete their own actors and a missing
      // row is a no-op.
      const userId = await makeUser(`q40-${uuidv7()}@example.test`);

      const targetId = `q40-target-${uuidv7()}`;
      await db.insert(schema.auditLog).values({
        actorId: userId,
        action: "role.update",
        targetType: "role",
        targetId,
        before: { name: "before" },
        after: { name: "after" },
      });

      return { userId, targetId };
    }

    const entryFor = async (targetId: string) =>
      db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.targetId, targetId));

    it("lets a user be deleted, and keeps what they did", async () => {
      const { userId, targetId } = await actorWithEntry();

      // The delete that used to fail.
      await db.delete(schema.users).where(eq(schema.users.id, userId));

      const [entry] = await entryFor(targetId);
      expect(entry, "the entry must outlive the actor").toBeDefined();
      expect(entry!.actorId).toBeNull();
      // Everything the entry SAYS is untouched — only the author is gone.
      expect(entry!.action).toBe("role.update");
      expect(entry!.before).toEqual({ name: "before" });
      expect(entry!.after).toEqual({ name: "after" });
    });

    it("refuses to re-point an actor at somebody else", async () => {
      const { userId, targetId } = await actorWithEntry();
      const otherId = await makeUser(`q40-other-${uuidv7()}@example.test`);

      // Attributing an action to a different person is the exact forgery the
      // append-only rule exists for, and nulling is not a licence for it.
      await expectRefused(
        () =>
          db
            .update(schema.auditLog)
            .set({ actorId: otherId })
            .where(eq(schema.auditLog.targetId, targetId)),
        /append-only/i,
      );

      await db.delete(schema.users).where(eq(schema.users.id, userId));
      await db.delete(schema.users).where(eq(schema.users.id, otherId));
    });

    it("refuses a change smuggled in alongside the null", async () => {
      const { userId, targetId } = await actorWithEntry();

      // The reason the trigger compares whole rows rather than checking that
      // `actor_id` became null: one statement can do both.
      await expectRefused(
        () =>
          db
            .update(schema.auditLog)
            .set({ actorId: null, action: "tampered" })
            .where(eq(schema.auditLog.targetId, targetId)),
        /append-only/i,
      );

      const [entry] = await entryFor(targetId);
      expect(entry!.action).toBe("role.update");
      expect(entry!.actorId).toBe(userId);

      await db.delete(schema.users).where(eq(schema.users.id, userId));
    });

    it("refuses a second null once the actor is already gone", async () => {
      const { userId, targetId } = await actorWithEntry();
      await db.delete(schema.users).where(eq(schema.users.id, userId));

      // Not an anonymisation — there is nothing left to anonymise, so this is
      // just an UPDATE, and the log refuses those.
      await expectRefused(
        () =>
          db
            .update(schema.auditLog)
            .set({ actorId: null })
            .where(eq(schema.auditLog.targetId, targetId)),
        /append-only/i,
      );
    });
  });
});
