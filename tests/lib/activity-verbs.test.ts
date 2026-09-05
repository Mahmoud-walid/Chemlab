import { describe, expect, it } from "vitest";

import {
  ACTIVITY_OBJECT_TYPES,
  ACTIVITY_VERBS,
  isActivityVerb,
  verbGroup,
  verbGroups,
} from "@/lib/activity/verbs";

describe("the verb list", () => {
  it("has no duplicates", () => {
    // A duplicate in the list becomes a duplicate in the Postgres enum, which
    // fails the migration — but only once someone runs it.
    expect(new Set(ACTIVITY_VERBS).size).toBe(ACTIVITY_VERBS.length);
  });

  it("has no duplicate object types", () => {
    expect(new Set(ACTIVITY_OBJECT_TYPES).size).toBe(
      ACTIVITY_OBJECT_TYPES.length,
    );
  });

  it("shapes every verb as group.action", () => {
    // The list is what the filter menu groups by, so a verb without a dot
    // would become its own group of one.
    for (const verb of ACTIVITY_VERBS) {
      expect(verb, verb).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });

  it("groups verbs by their resource, in declaration order", () => {
    expect(verbGroups()).toEqual([
      "auth",
      "lesson",
      "comment",
      "exam",
      "admin",
    ]);
  });

  it("extracts the group from a verb", () => {
    expect(verbGroup("lesson.viewed")).toBe("lesson");
    expect(verbGroup("admin.page_toggled")).toBe("admin");
  });

  it("recognises only verbs it declares", () => {
    // The guard for anything arriving from a URL — a `?verb=` filter must not
    // put an unknown value into a query against an enum column.
    expect(isActivityVerb("lesson.viewed")).toBe(true);
    expect(isActivityVerb("lesson.viewd")).toBe(false);
    expect(isActivityVerb("")).toBe(false);
    expect(isActivityVerb("drop table")).toBe(false);
  });
});
