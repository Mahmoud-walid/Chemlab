import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import { listActivity, parseVerbFilter } from "@/db/queries/admin/activity";
import { parseListParams } from "@/db/queries/admin/list-params";
import { ACTIVITY_LIST_SPEC } from "@/db/queries/admin/activity";

/**
 * Drizzle wraps a database error, so the Postgres message — and the trigger's
 * text with it — lives on `.cause`, not on `.message`. Asserting on the
 * wrapper would pass for any failed query at all.
 */
async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause;
    return `${(error as Error).message} ${cause?.message ?? ""}`;
  }
  throw new Error("expected the query to be rejected, and it was not");
}

/**
 * The activity stream, against real Postgres.
 *
 * Two claims matter more than the rest and neither is visible from a unit
 * test: that a reader without `activity:read_pii` gets nulls FROM THE QUERY,
 * and that an event cannot be edited after the fact.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

const PREFIX = "suite-activity-";
let userId: string;

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  userId = uuidv7();
  await db.insert(schema.users).values({
    id: userId,
    email: `${PREFIX}${Date.now()}@activity.invalid`,
    name: "Activity Probe",
    emailVerified: false,
  });
});

afterAll(async () => {
  await db.delete(schema.users).where(eq(schema.users.id, userId));
  await close?.();
});

afterEach(async () => {
  await db
    .delete(schema.activityEvents)
    .where(eq(schema.activityEvents.actorId, userId));
  await db
    .delete(schema.activityEvents)
    .where(sql`${schema.activityEvents.objectId} like ${`${PREFIX}%`}`);
});

async function insert(
  values: Partial<typeof schema.activityEvents.$inferInsert> = {},
) {
  const id = uuidv7();
  await db.insert(schema.activityEvents).values({
    id,
    actorId: userId,
    verb: "lesson.viewed",
    objectType: "lesson",
    objectId: `${PREFIX}one`,
    ipAddress: "203.0.113.0",
    userAgent: "Probe/1.0",
    ...values,
  });
  return id;
}

const list = (over: Record<string, string> = {}) =>
  parseListParams(over, ACTIVITY_LIST_SPEC);

describe("personal data", () => {
  it("is returned to a reader who holds activity:read_pii", async () => {
    await insert();
    const { rows } = await listActivity(list(), { actorId: userId }, true);
    expect(rows[0]?.ipAddress).toBe("203.0.113.0");
    expect(rows[0]?.userAgent).toBe("Probe/1.0");
  });

  it("is null for a reader who does not — from the query, not the template", async () => {
    await insert();
    const { rows } = await listActivity(list(), { actorId: userId }, false);

    expect(rows[0]?.ipAddress).toBeNull();
    expect(rows[0]?.userAgent).toBeNull();
    // The rest of the event is still there: withholding personal data must not
    // mean withholding the event.
    expect(rows[0]?.verb).toBe("lesson.viewed");
    expect(rows[0]?.actorEmail).toContain(PREFIX);
  });

  it("is absent from the serialised row entirely, not merely blank", async () => {
    await insert();
    const { rows } = await listActivity(list(), { actorId: userId }, false);
    // A row that reached the browser with the address in it would leak it
    // however the template chose to render.
    expect(JSON.stringify(rows)).not.toContain("203.0.113");
    expect(JSON.stringify(rows)).not.toContain("Probe/1.0");
  });
});

describe("an event", () => {
  it("cannot be edited after the fact", async () => {
    const id = await insert();
    // An event is a statement about something that happened. Editing one is
    // not a correction; it is a lie about the past.
    const message = await rejectionMessage(
      db
        .update(schema.activityEvents)
        .set({ verb: "lesson.completed" })
        .where(eq(schema.activityEvents.id, id)),
    );
    expect(message).toMatch(/only redaction is permitted/i);
  });

  it("refuses to put a redacted actor back", async () => {
    // Redaction only ever removes. An UPDATE that restored an actor id would
    // be un-anonymising somebody who asked to be forgotten.
    const id = await insert();
    await db
      .update(schema.activityEvents)
      .set({ actorId: null })
      .where(eq(schema.activityEvents.id, id));

    const message = await rejectionMessage(
      db
        .update(schema.activityEvents)
        .set({ actorId: userId })
        .where(eq(schema.activityEvents.id, id)),
    );
    expect(message).toMatch(/only be set to NULL/i);
  });

  it("allows the 90-day purge to empty the personal-data columns", async () => {
    const id = await insert();
    await db
      .update(schema.activityEvents)
      .set({ ipAddress: null, userAgent: null })
      .where(eq(schema.activityEvents.id, id));

    const [row] = await db
      .select()
      .from(schema.activityEvents)
      .where(eq(schema.activityEvents.id, id));
    expect(row?.ipAddress).toBeNull();
    expect(row?.userAgent).toBeNull();
    // The event itself survives its personal data being purged.
    expect(row?.verb).toBe("lesson.viewed");
  });

  it("can still be deleted, so retention can run", async () => {
    // Unlike audit_log, which refuses DELETE too: this table is pruned at 180
    // days and a trigger refusing DELETE would make that impossible.
    const id = await insert();
    await db
      .delete(schema.activityEvents)
      .where(eq(schema.activityEvents.id, id));
    const { total } = await listActivity(list(), { actorId: userId }, true);
    expect(total).toBe(0);
  });

  it("survives its actor being deleted, anonymised rather than removed", async () => {
    const doomed = uuidv7();
    await db.insert(schema.users).values({
      id: doomed,
      email: `${PREFIX}doomed-${Date.now()}@activity.invalid`,
      name: "Doomed",
      emailVerified: false,
    });
    await insert({ actorId: doomed, objectId: `${PREFIX}orphan` });

    await db.delete(schema.users).where(eq(schema.users.id, doomed));

    // `on delete set null`, not cascade: aggregate counts must not change when
    // somebody closes their account.
    const [row] = await db
      .select()
      .from(schema.activityEvents)
      .where(eq(schema.activityEvents.objectId, `${PREFIX}orphan`));
    expect(row).toBeTruthy();
    expect(row!.actorId).toBeNull();
  });
});

describe("filtering", () => {
  it("narrows to one verb", async () => {
    await insert({ verb: "lesson.viewed" });
    await insert({ verb: "lesson.completed", objectId: `${PREFIX}two` });

    const { rows } = await listActivity(
      list(),
      { actorId: userId, verb: "lesson.completed" },
      true,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.verb).toBe("lesson.completed");
  });

  it("narrows to a whole group with one filter", async () => {
    await insert({ verb: "lesson.viewed" });
    await insert({
      verb: "auth.signed_in",
      objectType: "user",
      objectId: userId,
    });

    const { rows } = await listActivity(
      list(),
      { actorId: userId, group: "lesson" },
      true,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.verb).toBe("lesson.viewed");
  });

  it("narrows to a date range", async () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await insert({ createdAt: old, objectId: `${PREFIX}old` });
    await insert({ objectId: `${PREFIX}new` });

    const { rows } = await listActivity(
      list(),
      { actorId: userId, from: new Date(Date.now() - 60 * 60 * 1000) },
      true,
    );
    expect(rows.map((row) => row.objectId)).toEqual([`${PREFIX}new`]);
  });

  it("returns newest first", async () => {
    await insert({
      createdAt: new Date(Date.now() - 60_000),
      objectId: `${PREFIX}older`,
    });
    await insert({ objectId: `${PREFIX}newer` });

    const { rows } = await listActivity(list(), { actorId: userId }, true);
    expect(rows.map((row) => row.objectId)).toEqual([
      `${PREFIX}newer`,
      `${PREFIX}older`,
    ]);
  });
});

describe("parseVerbFilter", () => {
  it("accepts a declared verb", () => {
    expect(parseVerbFilter("lesson.viewed")).toBe("lesson.viewed");
  });

  it("rejects anything else, so a query string cannot reach the enum", () => {
    // Postgres refuses an unknown enum value with an error, which would turn a
    // crafted URL into a 500.
    expect(parseVerbFilter("lesson.viewd")).toBeUndefined();
    expect(
      parseVerbFilter("'; drop table activity_events; --"),
    ).toBeUndefined();
    expect(parseVerbFilter(undefined)).toBeUndefined();
  });
});
