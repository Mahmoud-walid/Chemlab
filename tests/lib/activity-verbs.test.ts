import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";

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

describe("every verb is presentable", () => {
  /**
   * The gap this closes, and it was two gaps.
   *
   * `exam.voided` was added to the enum, written by the void action, and
   * shipped with no label at all. And the labels that DID exist were stored as
   * flat keys containing a dot — `verbs: { "exam.submitted": … }` — which
   * next-intl cannot resolve: it splits a key on dots and walks, so every
   * screen rendering a verb was rendering the raw key back at the reader.
   * Nothing failed, because nothing tied the verb list to the catalogue and
   * nothing resolved a label the way next-intl does.
   *
   * So this walks the path exactly as next-intl does rather than looking the
   * whole verb up as one key.
   */
  const catalogues: Record<string, unknown> = {
    en: en.admin.activity.verbs,
    ar: ar.admin.activity.verbs,
  };

  /** `exam.submitted` -> catalogue.exam.submitted, or undefined. */
  function resolve(catalogue: unknown, verb: string): string | undefined {
    let node: unknown = catalogue;
    for (const segment of verb.split(".")) {
      if (typeof node !== "object" || node === null) return undefined;
      node = (node as Record<string, unknown>)[segment];
    }
    return typeof node === "string" ? node : undefined;
  }

  it("resolves a label in both locales, the way next-intl would", () => {
    for (const [locale, catalogue] of Object.entries(catalogues)) {
      const missing = ACTIVITY_VERBS.filter(
        (verb) => !resolve(catalogue, verb),
      );
      expect(missing, `${locale} cannot resolve these verbs`).toEqual([]);
    }
  });

  it("holds no label for a verb that no longer exists", () => {
    // The other direction: a verb removed from the enum leaves a message
    // nothing reads, and the next person cannot tell whether it is dead or
    // whether the code that used it went missing.
    const declared = new Set<string>(ACTIVITY_VERBS);
    for (const [locale, catalogue] of Object.entries(catalogues)) {
      const orphans: string[] = [];
      for (const [group, actions] of Object.entries(
        catalogue as Record<string, Record<string, string>>,
      )) {
        for (const action of Object.keys(actions)) {
          if (!declared.has(`${group}.${action}`))
            orphans.push(`${group}.${action}`);
        }
      }
      expect(orphans, `${locale} has labels for unknown verbs`).toEqual([]);
    }
  });
});
