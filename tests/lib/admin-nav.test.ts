import { describe, expect, it } from "vitest";

import {
  ADMIN_NAV,
  breadcrumbsFor,
  flattenNav,
  hrefFor,
  permissionForPath,
  visibleNav,
} from "@/lib/admin/nav";
import { ROLES } from "@/db/seed/rbac";
import { isKnownPermission } from "@/lib/authz-core";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";

describe("the nav declaration", () => {
  it("guards every item with a permission that actually exists", () => {
    // A typo here would hide the item from everyone, which reads as a missing
    // feature rather than a broken permission name.
    for (const item of flattenNav(ADMIN_NAV)) {
      expect(isKnownPermission(item.permission), item.permission).toBe(true);
    }
  });

  it("shows the Editor role every section it can author in", () => {
    // The permission a section is guarded by must be one the people who do
    // that work actually hold. `exam:read` exists, so the "does this
    // permission exist" test above passed while the quizzes section was
    // guarded by it — but it means "view attempts and scores", which an
    // Editor does not hold, so an Editor holding every `quiz:*` permission
    // could not see the section at all.
    const editor = ROLES.find((role) => role.key === "editor");
    expect(editor, "no editor role").toBeTruthy();
    const held = new Set(editor!.permissions);

    for (const [segment, authoring] of [
      ["elements", "element:update"],
      ["lessons", "lesson:update"],
      ["quizzes", "quiz:update"],
    ] as const) {
      const item = flattenNav(ADMIN_NAV).find((i) => i.segment === segment);
      expect(item, segment).toBeTruthy();
      expect(held.has(authoring), `${segment}: editor should author here`).toBe(
        true,
      );
      expect(
        held.has(item!.permission),
        `${segment} is guarded by ${item!.permission}, which an Editor does not hold`,
      ).toBe(true);
    }
  });

  it("has a unique segment per item", () => {
    const segments = flattenNav(ADMIN_NAV).map((item) => item.segment);
    expect(new Set(segments).size).toBe(segments.length);
  });

  it("builds hrefs under /admin, with the dashboard at the root", () => {
    expect(hrefFor("")).toBe("/admin");
    expect(hrefFor("lessons")).toBe("/admin/lessons");
  });
});

describe("visibleNav", () => {
  it("shows a narrow role exactly what it holds, and nothing else", () => {
    const groups = visibleNav(new Set(["element:read"]), false);
    const items = flattenNav(groups);

    expect(items.map((item) => item.segment)).toEqual(["elements"]);
    // No Settings, Users or Activity — and no empty "People" heading either.
    expect(groups.map((group) => group.labelKey)).toEqual(["groups.content"]);
  });

  it("drops a group whose every item is filtered away", () => {
    // An empty heading advertises a section the viewer cannot reach.
    const groups = visibleNav(new Set(["admin:access"]), false);
    expect(groups).toHaveLength(1);
    expect(flattenNav(groups).map((item) => item.segment)).toEqual([""]);
  });

  it("shows a Super Admin everything, holding no permissions at all", () => {
    const groups = visibleNav(new Set(), true);
    expect(flattenNav(groups)).toHaveLength(flattenNav(ADMIN_NAV).length);
  });

  it("shows an anonymous viewer nothing", () => {
    expect(visibleNav(new Set(), false)).toEqual([]);
  });
});

describe("breadcrumbsFor", () => {
  it("starts at the dashboard and marks it current at the root", () => {
    expect(breadcrumbsFor("/admin")).toEqual([
      { href: "/admin", labelKey: "items.dashboard", isCurrent: true },
    ]);
  });

  it("uses the nav's label key for a known segment, not the raw URL", () => {
    const crumbs = breadcrumbsFor("/admin/roles");
    expect(crumbs).toHaveLength(2);
    expect(crumbs[1]).toEqual({
      href: "/admin/roles",
      labelKey: "items.roles",
      isCurrent: true,
    });
  });

  it("resolves a dynamic segment to the record's title", () => {
    // Otherwise the trail renders a UUID.
    const crumbs = breadcrumbsFor("/admin/lessons/01a06e9a", {
      "01a06e9a": "Introduction / Basics",
    });
    expect(crumbs.at(-1)).toEqual({
      href: "/admin/lessons/01a06e9a",
      label: "Introduction / Basics",
      isCurrent: true,
    });
    expect(crumbs.at(-2)?.labelKey).toBe("items.lessons");
  });

  it("falls back to the segment when no title was supplied", () => {
    expect(breadcrumbsFor("/admin/lessons/unknown-id").at(-1)?.label).toBe(
      "unknown-id",
    );
  });

  it("ignores the locale prefix", () => {
    // "/ar/admin/roles" is the same trail as "/admin/roles"; without this the
    // first crumb would be "ar".
    expect(breadcrumbsFor("/ar/admin/roles")).toEqual(
      breadcrumbsFor("/admin/roles"),
    );
    expect(breadcrumbsFor("/en/admin")).toEqual(breadcrumbsFor("/admin"));
  });

  it("marks only the last crumb as current", () => {
    const crumbs = breadcrumbsFor("/admin/lessons/abc");
    expect(crumbs.filter((crumb) => crumb.isCurrent)).toHaveLength(1);
    expect(crumbs.at(-1)?.isCurrent).toBe(true);
  });
});

describe("the nav's message keys", () => {
  it("resolves every label in both catalogues", () => {
    // The keys are literal unions rather than `string`, so TypeScript catches a
    // typo — but only against the English shape. This catches a key that
    // exists in one catalogue and not the other, which would render the raw
    // key to Arabic readers.
    const resolve = (tree: Record<string, unknown>, key: string) =>
      key
        .split(".")
        .reduce<unknown>(
          (node, part) =>
            typeof node === "object" && node !== null
              ? (node as Record<string, unknown>)[part]
              : undefined,
          tree,
        );

    for (const catalogue of [en, ar]) {
      const admin = (catalogue as Record<string, unknown>).admin as Record<
        string,
        unknown
      >;
      expect(admin, "the admin namespace").toBeTruthy();

      for (const group of ADMIN_NAV) {
        expect(typeof resolve(admin, group.labelKey), group.labelKey).toBe(
          "string",
        );
        for (const item of group.items) {
          expect(typeof resolve(admin, item.labelKey), item.labelKey).toBe(
            "string",
          );
        }
      }
    }
  });
});

describe("permissionForPath", () => {
  it("maps a section to the permission its nav entry declares", () => {
    expect(permissionForPath("/admin/elements")).toBe("element:read");
    expect(permissionForPath("/admin/settings")).toBe("setting:read");
    expect(permissionForPath("/admin/roles")).toBe("role:read");
  });

  it("uses the section's permission for a record beneath it", () => {
    expect(permissionForPath("/admin/elements/10")).toBe("element:read");
  });

  it("maps the dashboard itself", () => {
    expect(permissionForPath("/admin")).toBe("admin:access");
    expect(permissionForPath("/admin/")).toBe("admin:access");
  });

  it("ignores the locale prefix", () => {
    expect(permissionForPath("/ar/admin/elements")).toBe("element:read");
    expect(permissionForPath("/en/admin")).toBe("admin:access");
  });

  it("claims nothing for a section the nav does not declare", () => {
    // Such a route is protected by its own page, not by this.
    expect(permissionForPath("/admin/not-a-section")).toBeNull();
  });
});
