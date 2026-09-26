import { describe, expect, it } from "vitest";

import {
  ROLE_KEY_PATTERN,
  refusalsForAssign,
  refusalsForPermissionEdit,
  refusalsForRevoke,
  refusalsForRoleClone,
  refusalsForRoleCreate,
  refusalsForRoleDelete,
  refusalsForRoleRename,
  type RoleActor,
  type RoleFacts,
} from "@/lib/authz-roles";

/**
 * The escalation hole this module exists to close.
 *
 * `role:assign` is held by the seeded Admin role. If holding it were enough to
 * grant any role, an Admin could grant themselves `super_admin` and the
 * distinction between the two roles in `db/seed/rbac.ts` would be decoration.
 * Several tests below are that exact attack, written out.
 */

function actor(overrides: Partial<RoleActor> = {}): RoleActor {
  return {
    userId: "actor-1",
    permissions: new Set<string>(),
    isSuperAdmin: false,
    ...overrides,
  };
}

function role(overrides: Partial<RoleFacts> = {}): RoleFacts {
  return {
    key: "editor",
    permissionNames: ["lesson:read", "lesson:create"],
    isSystem: true,
    isProtected: false,
    ...overrides,
  };
}

const SUPER_ADMIN = role({
  key: "super_admin",
  // Empty on purpose — its power is a short-circuit, not grant rows. A test
  // that gave it permissions here would be testing a database that cannot
  // exist.
  permissionNames: [],
  isSystem: true,
  isProtected: true,
});

const superAdminActor = actor({ isSuperAdmin: true });

const adminActor = actor({
  permissions: new Set([
    "role:assign",
    "lesson:read",
    "lesson:create",
    "lesson:update",
  ]),
});

describe("granting a role", () => {
  it("lets a Super Admin grant anything", () => {
    expect(
      refusalsForAssign({
        actor: superAdminActor,
        role: SUPER_ADMIN,
        targetRoleKeys: [],
      }),
    ).toEqual([]);
  });

  it("refuses super_admin to anybody who is not one", () => {
    // The attack, stated plainly: an Admin holds `role:assign`, and without
    // this check that is enough.
    expect(
      refusalsForAssign({
        actor: adminActor,
        role: SUPER_ADMIN,
        targetRoleKeys: [],
      }),
    ).toContain("needs-super-admin");
  });

  it("refuses a role granting more than the actor holds", () => {
    // The general form. `role:assign` does not mean "assign anything".
    const powerful = role({
      key: "auditor",
      permissionNames: ["lesson:read", "audit:read"],
      isSystem: false,
    });
    expect(
      refusalsForAssign({
        actor: adminActor,
        role: powerful,
        targetRoleKeys: [],
      }),
    ).toEqual(["would-escalate"]);
  });

  it("allows a role whose grants the actor already holds, exactly", () => {
    expect(
      refusalsForAssign({
        actor: adminActor,
        role: role({ permissionNames: ["lesson:read", "lesson:create"] }),
        targetRoleKeys: [],
      }),
    ).toEqual([]);
  });

  it("allows a role that grants nothing", () => {
    // `member` — every signup holds it, and "authenticated but unprivileged"
    // has to be grantable by anybody who can assign at all.
    expect(
      refusalsForAssign({
        actor: adminActor,
        role: role({ key: "member", permissionNames: [] }),
        targetRoleKeys: [],
      }),
    ).toEqual([]);
  });

  it("refuses a role the target already holds", () => {
    expect(
      refusalsForAssign({
        actor: adminActor,
        role: role({ key: "editor" }),
        targetRoleKeys: ["member", "editor"],
      }),
    ).toEqual(["already-held"]);
  });

  it("reports every reason at once, not the first", () => {
    // The project's rule: an operator who clears one refusal and is then told
    // about the next has been made to discover the rules one round trip at a
    // time.
    const refusals = refusalsForAssign({
      actor: adminActor,
      role: SUPER_ADMIN,
      targetRoleKeys: ["super_admin"],
    });
    expect(refusals).toEqual(["needs-super-admin", "already-held"]);
  });
});

describe("revoking a role", () => {
  const base = {
    actor: adminActor,
    targetUserId: "someone-else",
    targetRoleKeys: ["editor"],
    remainingRoles: [] as RoleFacts[],
    superAdminHolders: 2,
  };

  it("allows revoking a role the actor could also grant", () => {
    expect(refusalsForRevoke({ ...base, role: role() })).toEqual([]);
  });

  it("refuses a role the target does not hold", () => {
    expect(
      refusalsForRevoke({
        ...base,
        role: role({ key: "moderator", permissionNames: [] }),
      }),
    ).toEqual(["not-held"]);
  });

  it("refuses revoking super_admin unless the actor is one", () => {
    expect(
      refusalsForRevoke({
        ...base,
        role: SUPER_ADMIN,
        targetRoleKeys: ["super_admin"],
      }),
    ).toContain("needs-super-admin");
  });

  it("refuses revoking a role more powerful than the actor's own", () => {
    // Symmetric with granting, and worth an explicit test because it is not
    // obvious: somebody who could revoke what they could not grant can
    // dismantle a role they are not trusted with.
    expect(
      refusalsForRevoke({
        ...base,
        role: role({
          key: "auditor",
          permissionNames: ["audit:read"],
          isSystem: false,
        }),
        targetRoleKeys: ["auditor"],
      }),
    ).toContain("would-escalate");
  });

  it("refuses the last super_admin, as the trigger would", () => {
    expect(
      refusalsForRevoke({
        ...base,
        actor: superAdminActor,
        role: SUPER_ADMIN,
        targetRoleKeys: ["super_admin"],
        superAdminHolders: 1,
      }),
    ).toEqual(["last-super-admin"]);
  });

  it("allows revoking super_admin while another holder remains", () => {
    expect(
      refusalsForRevoke({
        ...base,
        actor: superAdminActor,
        role: SUPER_ADMIN,
        targetRoleKeys: ["super_admin"],
        superAdminHolders: 2,
      }),
    ).toEqual([]);
  });

  it("does not cry last-super-admin for a role nobody holds", () => {
    // `superAdminHolders` of 0 with the role unheld is a stale page, not the
    // last holder — and reporting both would be two refusals for one mistake.
    expect(
      refusalsForRevoke({
        ...base,
        actor: superAdminActor,
        role: SUPER_ADMIN,
        targetRoleKeys: ["editor"],
        superAdminHolders: 0,
      }),
    ).toEqual(["not-held"]);
  });
});

describe("revoking from yourself", () => {
  const selfRole = role({
    key: "admin",
    permissionNames: ["role:assign", "lesson:read"],
  });

  it("refuses when it would cost the actor their own role:assign", () => {
    // The footgun: the only way back from this is a shell on the database.
    expect(
      refusalsForRevoke({
        actor: actor({
          userId: "me",
          permissions: new Set(["role:assign", "lesson:read"]),
        }),
        targetUserId: "me",
        role: selfRole,
        targetRoleKeys: ["admin"],
        remainingRoles: [role({ key: "member", permissionNames: [] })],
        superAdminHolders: 2,
      }),
    ).toEqual(["would-lock-out-self"]);
  });

  it("allows it when another role still carries role:assign", () => {
    expect(
      refusalsForRevoke({
        actor: actor({
          userId: "me",
          permissions: new Set(["role:assign", "lesson:read"]),
        }),
        targetUserId: "me",
        role: selfRole,
        targetRoleKeys: ["admin", "second"],
        remainingRoles: [
          role({ key: "second", permissionNames: ["role:assign"] }),
        ],
        superAdminHolders: 2,
      }),
    ).toEqual([]);
  });

  it("allows it when super_admin remains, which carries everything", () => {
    // Super Admin holds no grant rows, so a `permissionNames.includes` check
    // alone would decide it had lost `role:assign` and refuse.
    expect(
      refusalsForRevoke({
        actor: actor({ userId: "me", isSuperAdmin: true }),
        targetUserId: "me",
        role: role({ key: "admin", permissionNames: [] }),
        targetRoleKeys: ["admin", "super_admin"],
        remainingRoles: [SUPER_ADMIN],
        superAdminHolders: 1,
      }),
    ).toEqual([]);
  });

  it("does not apply to somebody else losing their last privileged role", () => {
    // Demoting another person is the ordinary case and must stay possible.
    expect(
      refusalsForRevoke({
        actor: actor({
          userId: "me",
          permissions: new Set(["role:assign", "lesson:read"]),
        }),
        targetUserId: "them",
        role: selfRole,
        targetRoleKeys: ["admin"],
        remainingRoles: [],
        superAdminHolders: 2,
      }),
    ).toEqual([]);
  });
});

describe("editing which permissions a role grants", () => {
  it("refuses a system role, because the seed would revert it", () => {
    // The finding that shaped the screen: `db/seed/authorization.ts` reconciles
    // every seeded role's grants on every deploy, so this edit would work, look
    // like it worked, and silently revert.
    expect(
      refusalsForPermissionEdit({
        actor: superAdminActor,
        role: role({ isSystem: true }),
        nextPermissionNames: ["lesson:read"],
      }),
    ).toContain("system-role");
  });

  it("allows a custom role, which the seed does not touch", () => {
    expect(
      refusalsForPermissionEdit({
        actor: superAdminActor,
        role: role({ key: "auditor", isSystem: false, permissionNames: [] }),
        nextPermissionNames: ["audit:read", "activity:read"],
      }),
    ).toEqual([]);
  });

  it("refuses a permission name that is not in the vocabulary", () => {
    // A typo like `lesson:publsh` stored as a grant would deny every caller and
    // look exactly like a guard that works.
    expect(
      refusalsForPermissionEdit({
        actor: superAdminActor,
        role: role({ isSystem: false }),
        nextPermissionNames: ["lesson:publsh"],
      }),
    ).toContain("unknown-permission");
  });

  it("refuses adding a permission the actor does not hold", () => {
    expect(
      refusalsForPermissionEdit({
        actor: adminActor,
        role: role({ key: "auditor", isSystem: false, permissionNames: [] }),
        nextPermissionNames: ["audit:read"],
      }),
    ).toEqual(["would-escalate"]);
  });

  it("allows REMOVING a permission the actor does not hold", () => {
    // Not escalation. Refusing it would leave an Admin unable to tidy up a role
    // they can otherwise edit, for no gain.
    expect(
      refusalsForPermissionEdit({
        actor: adminActor,
        role: role({
          key: "auditor",
          isSystem: false,
          permissionNames: ["audit:read", "lesson:read"],
        }),
        nextPermissionNames: ["lesson:read"],
      }),
    ).toEqual([]);
  });

  it("allows KEEPING a permission the actor does not hold while adding one", () => {
    // The case that separates "check what is added" from "check the whole
    // set" — and the previous test does not: there the only surviving name was
    // one the actor holds, so both readings agreed. Here `audit:read` stays on
    // a role that already had it, which is not the actor granting it.
    //
    // Measured: checking the whole set instead of the additions passes every
    // other test in this file. Without this one the distinction is untested.
    expect(
      refusalsForPermissionEdit({
        actor: adminActor,
        role: role({
          key: "auditor",
          isSystem: false,
          permissionNames: ["audit:read"],
        }),
        nextPermissionNames: ["audit:read", "lesson:read"],
      }),
    ).toEqual([]);
  });

  it("still refuses the addition when an untouched grant is beyond the actor", () => {
    // The other half: keeping `audit:read` is fine, adding `exam:export` is
    // not, and the refusal has to survive the presence of the first.
    expect(
      refusalsForPermissionEdit({
        actor: adminActor,
        role: role({
          key: "auditor",
          isSystem: false,
          permissionNames: ["audit:read"],
        }),
        nextPermissionNames: ["audit:read", "exam:export"],
      }),
    ).toEqual(["would-escalate"]);
  });

  it("lets a Super Admin grant anything in the vocabulary", () => {
    expect(
      refusalsForPermissionEdit({
        actor: superAdminActor,
        role: role({ key: "auditor", isSystem: false, permissionNames: [] }),
        nextPermissionNames: [
          "lesson:delete_hard",
          "notification:subscribe_ci",
        ],
      }),
    ).toEqual([]);
  });
});

describe("deleting a role", () => {
  it("refuses a protected role", () => {
    expect(
      refusalsForRoleDelete({ role: SUPER_ADMIN, holderCount: 0 }),
    ).toContain("protected");
  });

  it("refuses a system role, which the next seed would recreate", () => {
    expect(
      refusalsForRoleDelete({
        role: role({ isSystem: true, isProtected: false }),
        holderCount: 0,
      }),
    ).toContain("system-role");
  });

  it("refuses a role people still hold", () => {
    // `user_roles.role_id` is RESTRICT, not CASCADE: deleting a held role would
    // silently strip access. The count is what the operator needs.
    expect(
      refusalsForRoleDelete({
        role: role({ key: "auditor", isSystem: false }),
        holderCount: 3,
      }),
    ).toEqual(["has-holders"]);
  });

  it("allows an unheld custom role", () => {
    expect(
      refusalsForRoleDelete({
        role: role({ key: "auditor", isSystem: false }),
        holderCount: 0,
      }),
    ).toEqual([]);
  });

  it("reports protection AND holders together", () => {
    expect(
      refusalsForRoleDelete({ role: SUPER_ADMIN, holderCount: 2 }),
    ).toEqual(["protected", "system-role", "has-holders"]);
  });
});

describe("creating a role", () => {
  const existing = ["super_admin", "admin", "editor"];

  it("accepts a lower_snake_case key", () => {
    expect(
      refusalsForRoleCreate({
        key: "content_auditor",
        name: "Content auditor",
        existingKeys: existing,
      }),
    ).toEqual([]);
  });

  it("refuses a key that is not an identifier", () => {
    // The key is frozen by a trigger once the role is a system role, and it is
    // what code matches on — so a label in the key field is permanent.
    for (const key of [
      "Content Auditor",
      "content-auditor",
      "9lives",
      "_leading",
      "a",
      "",
      "içerik",
    ]) {
      expect(
        refusalsForRoleCreate({ key, name: "x", existingKeys: existing }),
        key,
      ).toContain("bad-key");
    }
  });

  it("refuses a key that is taken", () => {
    expect(
      refusalsForRoleCreate({
        key: "editor",
        name: "Editor",
        existingKeys: existing,
      }),
    ).toEqual(["key-taken"]);
  });

  it("refuses a blank display name, whitespace included", () => {
    expect(
      refusalsForRoleCreate({
        key: "auditor",
        name: "   ",
        existingKeys: existing,
      }),
    ).toEqual(["no-name"]);
  });

  it("caps the key length rather than letting the column decide", () => {
    expect(ROLE_KEY_PATTERN.test("a".repeat(39))).toBe(true);
    expect(ROLE_KEY_PATTERN.test("a".repeat(40))).toBe(false);
  });
});

describe("renaming a role", () => {
  it("accepts a new name on a custom role", () => {
    expect(
      refusalsForRoleRename({
        role: role({ key: "auditor", isSystem: false }),
        name: "Content auditor",
      }),
    ).toEqual([]);
  });

  it("refuses a system role, because the seed rewrites its name too", () => {
    // The less obvious half of the seed problem. `roles_protect_system` freezes
    // only the KEY, so the database would allow this rename — and
    // `db/seed/authorization.ts` would put "Editor" back on the next deploy
    // with nothing reporting it.
    expect(
      refusalsForRoleRename({
        role: role({ isSystem: true }),
        name: "Content editor",
      }),
    ).toContain("system-role");
  });

  it("refuses a blank name, whitespace included", () => {
    expect(
      refusalsForRoleRename({
        role: role({ key: "auditor", isSystem: false }),
        name: "   ",
      }),
    ).toEqual(["no-name"]);
  });

  it("does not consult the actor's own permissions — a label is not power", () => {
    // Renaming is `role:update` and nothing more. Gating it on the grants would
    // mean an Admin could not fix a typo on a role they can otherwise edit.
    expect(
      refusalsForRoleRename({
        role: role({
          key: "auditor",
          isSystem: false,
          permissionNames: ["audit:read"],
        }),
        name: "Auditor",
      }),
    ).toEqual([]);
  });
});

describe("cloning a role", () => {
  it("lets an Admin clone a role whose grants they hold", () => {
    expect(
      refusalsForRoleClone({
        actor: adminActor,
        source: role({ permissionNames: ["lesson:read", "lesson:create"] }),
      }),
    ).toEqual([]);
  });

  it("refuses a source granting more than the actor holds", () => {
    // Without this, cloning launders the escalation: copy the grants into a new
    // role, and `refusalsForAssign` then permits handing it out, because by
    // then the permissions are the new role's own.
    expect(
      refusalsForRoleClone({
        actor: adminActor,
        source: role({
          key: "auditor",
          permissionNames: ["audit:read"],
          isSystem: false,
        }),
      }),
    ).toEqual(["would-escalate"]);
  });

  it("allows cloning super_admin, which copies nothing", () => {
    // No special case needed: it holds no grant rows, so the copy is an empty
    // role. The short-circuit lives on the KEY and does not travel.
    expect(
      refusalsForRoleClone({ actor: adminActor, source: SUPER_ADMIN }),
    ).toEqual([]);
  });

  it("lets a Super Admin clone anything", () => {
    expect(
      refusalsForRoleClone({
        actor: superAdminActor,
        source: role({
          key: "auditor",
          permissionNames: ["audit:read", "lesson:delete_hard"],
          isSystem: false,
        }),
      }),
    ).toEqual([]);
  });

  it("allows cloning a SYSTEM role, unlike editing one", () => {
    // The asymmetry is the point, and it is what makes a system role's power
    // customisable at all: the seed reconciles the ORIGINAL, and the copy is a
    // custom role it never touches.
    expect(
      refusalsForRoleClone({
        actor: adminActor,
        source: role({ isSystem: true, permissionNames: ["lesson:read"] }),
      }),
    ).toEqual([]);
  });
});
