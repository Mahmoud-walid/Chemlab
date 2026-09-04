import { describe, expect, it } from "vitest";

import {
  buildContext,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  ForbiddenError,
  isKnownPermission,
  knownPermissionNames,
  UnauthenticatedError,
  UnknownPermissionError,
  type PermissionContext,
} from "@/lib/authz-core";
import { allPermissionNames, PERMISSIONS, ROLES } from "@/db/seed/rbac";

const context = (
  permissions: string[],
  isSuperAdmin = false,
): PermissionContext => ({
  userId: "u1",
  permissions: new Set(permissions),
  isSuperAdmin,
});

describe("hasPermission", () => {
  it("grants what the user holds and denies what they do not", () => {
    const editor = context(["lesson:publish", "lesson:update"]);
    expect(hasPermission(editor, "lesson:publish")).toBe(true);
    expect(hasPermission(editor, "user:delete")).toBe(false);
  });

  it("grants a Super Admin everything, with an empty permission set", () => {
    // The whole point: Super Admin power is a short-circuit, not rows. A Super
    // Admin who could be defanged by deleting a join row is not a Super Admin.
    const superAdmin = context([], true);
    for (const name of allPermissionNames()) {
      expect(hasPermission(superAdmin, name), name).toBe(true);
    }
  });

  it("throws on an unknown permission rather than denying it", () => {
    // A typo that silently denied would look exactly like a guard that works —
    // invisible until someone removes the "broken" check and finds it was the
    // only thing standing there.
    expect(() => hasPermission(context([]), "lesson:publsh")).toThrow(
      UnknownPermissionError,
    );
    expect(() => hasPermission(context([], true), "made:up")).toThrow(
      UnknownPermissionError,
    );
  });
});

describe("hasAllPermissions / hasAnyPermission", () => {
  const editor = context(["lesson:publish", "lesson:update"]);

  it("requires every name for all, and one for any", () => {
    expect(hasAllPermissions(editor, ["lesson:publish", "lesson:update"])).toBe(
      true,
    );
    expect(hasAllPermissions(editor, ["lesson:publish", "user:delete"])).toBe(
      false,
    );
    expect(hasAnyPermission(editor, ["user:delete", "lesson:publish"])).toBe(
      true,
    );
    expect(hasAnyPermission(editor, ["user:delete", "role:create"])).toBe(
      false,
    );
  });

  it("still catches a typo in a later name after an earlier one matched", () => {
    // Short-circuiting would skip the typo and report success.
    expect(() =>
      hasAnyPermission(editor, ["lesson:publish", "lesson:publsh"]),
    ).toThrow(UnknownPermissionError);
  });
});

describe("buildContext", () => {
  it("unions the permissions across a user's roles", () => {
    const built = buildContext(
      "u1",
      [
        { roleKey: "editor", permission: "lesson:publish" },
        { roleKey: "editor", permission: "lesson:update" },
        { roleKey: "moderator", permission: "comment:moderate" },
      ],
      "super_admin",
    );
    expect([...built.permissions].sort()).toEqual([
      "comment:moderate",
      "lesson:publish",
      "lesson:update",
    ]);
    expect(built.isSuperAdmin).toBe(false);
  });

  it("recognises the Super Admin role even with no permission rows", () => {
    // `member` and `super_admin` both come back with a null permission from the
    // LEFT JOIN; only one of them is all-powerful.
    const built = buildContext(
      "u1",
      [{ roleKey: "super_admin", permission: null }],
      "super_admin",
    );
    expect(built.isSuperAdmin).toBe(true);
    expect(built.permissions.size).toBe(0);
  });

  it("treats a role with no grants as exactly that", () => {
    const built = buildContext(
      "u1",
      [{ roleKey: "member", permission: null }],
      "super_admin",
    );
    expect(built.isSuperAdmin).toBe(false);
    expect(built.permissions.size).toBe(0);
  });
});

describe("the permission vocabulary", () => {
  it("has a unique name per resource/action pair", () => {
    const names = allPermissionNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it("names every permission as resource:action", () => {
    for (const spec of PERMISSIONS) {
      expect(`${spec.resource}:${spec.action}`).toMatch(
        /^[a-z]+(?:_[a-z]+)*:[a-z]+$/,
      );
      expect(spec.description.trim()).not.toBe("");
    }
  });

  it("grants only permissions that exist, in every seeded role", () => {
    // A role granting a name the vocabulary does not define would look like it
    // worked and protect nothing.
    for (const role of ROLES) {
      for (const name of role.permissions ?? []) {
        expect(isKnownPermission(name), `${role.key} grants ${name}`).toBe(
          true,
        );
      }
    }
  });

  it("gives the Super Admin implicit power and the member none", () => {
    expect(ROLES.find((r) => r.key === "super_admin")?.permissions).toBeNull();
    expect(ROLES.find((r) => r.key === "member")?.permissions).toEqual([]);
  });

  it("exposes the same set through knownPermissionNames", () => {
    expect(knownPermissionNames().size).toBe(allPermissionNames().length);
  });
});

describe("the error types", () => {
  it("distinguishes 'not signed in' from 'not allowed'", () => {
    // The caller has to be able to tell these apart: one is a redirect to
    // sign-in, the other is a 404 or a 403. Collapsing them either leaks that
    // a resource exists, or sends a signed-in user to sign in again forever.
    const forbidden = new ForbiddenError("lesson:publish");
    expect(forbidden).toBeInstanceOf(Error);
    expect(forbidden.name).toBe("ForbiddenError");
    expect(forbidden.permission).toBe("lesson:publish");
    expect(forbidden.message).toContain("lesson:publish");

    const anonymous = new UnauthenticatedError();
    expect(anonymous).toBeInstanceOf(Error);
    expect(anonymous.name).toBe("UnauthenticatedError");
    expect(anonymous).not.toBeInstanceOf(ForbiddenError);
  });

  it("names the mistake and says why it is not a denial", () => {
    const error = new UnknownPermissionError("lesson:publsh");
    expect(error.name).toBe("UnknownPermissionError");
    expect(error.message).toContain("lesson:publsh");
    // The message has to explain the design, or the next person "fixes" it by
    // making unknown names deny — which is what hides the typo.
    expect(error.message).toMatch(/deny/i);
    expect(error.message).toContain("db/seed/rbac.ts");
  });
});
