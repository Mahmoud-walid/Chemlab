import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  NOTIFICATION_SPECS,
  NOTIFICATION_TYPES,
  aggregatingTypesSql,
  aggregationPredicate,
  isNotificationType,
  specFor,
} from "@/lib/notifications/types";

/**
 * The catalogue, and the one place it is duplicated.
 *
 * The aggregation index in the migration names the aggregating types in SQL,
 * because a partial unique index cannot read a TypeScript object. That
 * duplication is only safe if something checks the two still agree — which is
 * what the last test here does. Adding an aggregating type without extending
 * the index would otherwise mean five likes producing five rows, silently.
 */

describe("the catalogue", () => {
  it("rejects a type that is not on the list", () => {
    expect(isNotificationType("comment.liked")).toBe(true);
    expect(isNotificationType("comment.disliked")).toBe(false);
    expect(isNotificationType("")).toBe(false);
  });

  it("gives every type a spec", () => {
    for (const type of NOTIFICATION_TYPES) {
      const spec = specFor(type);
      expect(spec.targeting).toMatch(/^(personal|broadcast)$/);
      expect(spec.subjectType).toBeTruthy();
    }
  });
});

describe("the aggregation index matches the catalogue", () => {
  it("names exactly the types whose spec says they aggregate", async () => {
    const migration = await readFile(
      path.join(process.cwd(), "db", "migrations", "0016_notifications.sql"),
      "utf8",
    );

    const line = migration
      .split("\n")
      .find((candidate) => candidate.includes("notifications_aggregate_idx"));
    expect(line, "the aggregation index is in the migration").toBeTruthy();

    const inSql = [...line!.matchAll(/'([a-z]+\.[a-z_]+)'/g)]
      .map((match) => match[1]!)
      .sort();

    const inCatalogue = NOTIFICATION_TYPES.filter(
      (type) => specFor(type).aggregates,
    )
      .map(String)
      .sort();

    expect(inSql).toEqual(inCatalogue);
  });

  it("excludes replies, which must not collapse", async () => {
    // Two replies to one comment are two things to read. With the index
    // applied to every type the database would REJECT the second rather than
    // collapse it — a constraint error where a notification should have been.
    expect(specFor("comment.replied").aggregates).toBe(false);
  });
});

describe("the SQL the index and the upsert share", () => {
  it("lists exactly the aggregating types, quoted", () => {
    // The migration writes this predicate by hand; deriving the upsert's copy
    // from the catalogue means there is only ever one hand-written copy.
    const sql = aggregatingTypesSql();
    for (const type of NOTIFICATION_TYPES) {
      const expected = NOTIFICATION_SPECS[type].aggregates;
      expect(sql.includes(`'${type}'`), type).toBe(expected);
    }
  });

  it("builds the predicate the arbiter index is inferred from", () => {
    // A near-miss is not a slow path: Postgres cannot infer the index and
    // answers 42P10 at query time, on the first aggregating event.
    expect(aggregationPredicate()).toBe(
      `read_at is null and type in (${aggregatingTypesSql()})`,
    );
    expect(aggregationPredicate().startsWith("read_at is null and")).toBe(true);
  });
});
