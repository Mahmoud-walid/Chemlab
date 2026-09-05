import { describe, expect, it } from "vitest";

import { breadcrumbsFor } from "@/lib/admin/nav";

/**
 * The breadcrumb's use of record titles.
 *
 * `breadcrumbsFor` has always accepted a `titles` map; until now nothing passed
 * one, so `/admin/elements/26` rendered a breadcrumb reading "26". These pin
 * the behaviour the admin layout now depends on.
 */
describe("breadcrumbs with record titles", () => {
  it("shows the record's title in place of its id", () => {
    const crumbs = breadcrumbsFor("/admin/elements/26", { "26": "Iron" });
    expect(crumbs.at(-1)?.label).toBe("Iron");
    expect(crumbs.at(-1)?.isCurrent).toBe(true);
  });

  it("falls back to the raw segment when no title is supplied", () => {
    // A record that was deleted, or a database that is unreachable — a
    // breadcrumb is not worth failing a page over.
    expect(breadcrumbsFor("/admin/elements/26").at(-1)?.label).toBe("26");
  });

  it("leaves the section crumb as a message key, not a title", () => {
    const crumbs = breadcrumbsFor("/admin/lessons/acids-bases-ph", {
      "acids-bases-ph": "Acids, Bases, and pH",
    });
    expect(crumbs.map((crumb) => crumb.labelKey ?? crumb.label)).toEqual([
      "items.dashboard",
      "items.lessons",
      "Acids, Bases, and pH",
    ]);
  });

  it("does not apply a title to a segment that is a known section", () => {
    // A record slugged "lessons" must not rename the Lessons crumb.
    const crumbs = breadcrumbsFor("/admin/lessons", { lessons: "Not this" });
    expect(crumbs.at(-1)?.labelKey).toBe("items.lessons");
  });

  it("is locale-independent", () => {
    expect(breadcrumbsFor("/ar/admin/elements/26", { "26": "Iron" })).toEqual(
      breadcrumbsFor("/admin/elements/26", { "26": "Iron" }),
    );
  });
});
