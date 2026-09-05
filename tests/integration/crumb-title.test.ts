import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import { elements } from "@/db/schema/content";
import { crumbTitlesFor } from "@/lib/admin/crumb-title";

/**
 * Resolving a record's title for the breadcrumb, against real Postgres.
 *
 * The interesting cases are the ones that must NOT query or must not throw:
 * the create screen, an unknown section, a record that does not exist. A
 * breadcrumb is not worth failing a page over.
 */

let close: () => Promise<void>;
let db: SeedDatabase;

beforeAll(() => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));
});

afterAll(async () => {
  await close?.();
});

describe("crumbTitlesFor", () => {
  it("resolves an element's name from its atomic number", async () => {
    // The case this exists for: a breadcrumb reading "26" says nothing.
    expect(await crumbTitlesFor("/admin/elements/26")).toEqual({
      "26": "Iron",
    });
  });

  it("resolves a lesson and a quiz from their slugs", async () => {
    expect(await crumbTitlesFor("/admin/lessons/introduction-basics")).toEqual({
      "introduction-basics": "Introduction / Basics",
    });
    expect(await crumbTitlesFor("/admin/quizzes/acids-and-bases")).toEqual({
      "acids-and-bases": "Acids & Bases",
    });
  });

  it("is locale-independent", async () => {
    expect(await crumbTitlesFor("/ar/admin/elements/26")).toEqual({
      "26": "Iron",
    });
  });

  it("returns nothing for a list screen, so no query is wasted", async () => {
    expect(await crumbTitlesFor("/admin/lessons")).toEqual({});
    expect(await crumbTitlesFor("/admin")).toEqual({});
  });

  it("returns nothing for the create screen", async () => {
    // `new` is a route, not a record; looking it up could only ever miss.
    expect(await crumbTitlesFor("/admin/lessons/new")).toEqual({});
    expect(await crumbTitlesFor("/admin/quizzes/new")).toEqual({});
  });

  it("returns nothing for a section it does not know", async () => {
    expect(await crumbTitlesFor("/admin/settings/general")).toEqual({});
  });

  it("returns nothing for a record that does not exist", async () => {
    expect(await crumbTitlesFor("/admin/lessons/no-such-lesson")).toEqual({});
    expect(await crumbTitlesFor("/admin/elements/9999")).toEqual({});
  });

  it("returns nothing for a non-numeric element segment rather than querying", async () => {
    // `elements.number` is an integer column; passing a slug would be a type
    // error at the database rather than a miss.
    expect(await crumbTitlesFor("/admin/elements/iron")).toEqual({});
  });

  it("sees an edit immediately — the breadcrumb is not cached", async () => {
    const [before] = await db
      .select({ name: elements.name })
      .from(elements)
      .where(eq(elements.number, 10));

    await db
      .update(elements)
      .set({ name: "Renamed" })
      .where(eq(elements.number, 10));

    try {
      expect(await crumbTitlesFor("/admin/elements/10")).toEqual({
        "10": "Renamed",
      });
    } finally {
      // Restored, so `pnpm db:verify` still matches data/.
      await db
        .update(elements)
        .set({ name: before!.name })
        .where(eq(elements.number, 10));
    }
  });
});
