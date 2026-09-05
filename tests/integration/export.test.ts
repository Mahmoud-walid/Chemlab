import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import {
  exportAttempts,
  exportEvents,
  exportFunnel,
  recentExportTimes,
} from "@/db/queries/admin/export";
import { csvRow } from "@/lib/exports/csv";

/**
 * The export path, against real Postgres.
 *
 * Three claims need a real database and none of them can be checked from a
 * unit test. **The PII columns are absent from the QUERY** for a reader
 * without the grant, not blanked afterwards. **Keyset paging returns every row
 * exactly once** across batch boundaries — the failure mode of OFFSET paging
 * over a table still being written to. And **the filters the screen applied
 * are the filters the file gets**, so an operator's download matches what they
 * were looking at.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

const ACTOR = `export-suite-${uuidv7()}`;
const OTHER = `export-other-${uuidv7()}`;
const OBJECT_PREFIX = `export-suite-${uuidv7()}`;
const EVENT_COUNT = 25;

let quizId: string;
const QUIZ_SLUG = `export-suite-quiz-${Date.now()}`;

async function drain(shape: {
  header: string[];
  rows: AsyncGenerator<string[][]>;
}): Promise<{ header: string[]; rows: string[][] }> {
  const rows: string[][] = [];
  for await (const batch of shape.rows) rows.push(...batch);
  return { header: shape.header, rows };
}

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  for (const id of [ACTOR, OTHER]) {
    await db.insert(schema.users).values({
      id,
      name: "Export suite",
      email: `${id}@export.invalid`,
      emailVerified: true,
    });
  }

  for (let i = 0; i < EVENT_COUNT; i++) {
    await db.insert(schema.activityEvents).values({
      id: uuidv7(),
      actorId: ACTOR,
      verb: "lesson.viewed",
      objectType: "lesson",
      objectId: `${OBJECT_PREFIX}-${String(i).padStart(3, "0")}`,
      ipAddress: "203.0.113.0",
      userAgent: "ExportSuite/1.0",
      createdAt: new Date(Date.UTC(2026, 2, 1, 0, i)),
    });
  }

  // One event of a different verb, so a verb filter has something to exclude.
  await db.insert(schema.activityEvents).values({
    id: uuidv7(),
    actorId: ACTOR,
    verb: "auth.signed_in",
    objectId: `${OBJECT_PREFIX}-signin`,
    createdAt: new Date(Date.UTC(2026, 2, 2)),
  });

  quizId = uuidv7();
  await db.insert(schema.quizzes).values({
    id: quizId,
    slug: QUIZ_SLUG,
    title: "Export suite quiz",
    description: "Created by tests/integration/export.test.ts.",
    difficulty: "easy",
    category: "Testing",
    status: "published",
    passMarkPercent: 50,
  });

  await db.insert(schema.examAttempts).values({
    id: uuidv7(),
    quizId,
    userId: ACTOR,
    attemptNumber: 1,
    status: "submitted",
    score: 7,
    maxScore: 10,
    passed: true,
    seed: 1,
    quizRevision: new Date(Date.UTC(2026, 1, 1)),
    startedAt: new Date(Date.UTC(2026, 2, 1)),
    submittedAt: new Date(Date.UTC(2026, 2, 1, 0, 20)),
  });
});

afterAll(async () => {
  await db
    .delete(schema.examAttempts)
    .where(eq(schema.examAttempts.quizId, quizId));
  await db.delete(schema.quizzes).where(eq(schema.quizzes.id, quizId));
  await db
    .delete(schema.activityEvents)
    .where(inArray(schema.activityEvents.actorId, [ACTOR, OTHER]));
  await db.delete(schema.users).where(inArray(schema.users.id, [ACTOR, OTHER]));
  await close?.();
});

describe("exportEvents", () => {
  it("returns every matching row exactly once across batches", async () => {
    const { rows } = await drain(
      exportEvents({ verb: "lesson.viewed", query: OBJECT_PREFIX }, true, 1000),
    );

    expect(rows).toHaveLength(EVENT_COUNT);
    const ids = new Set(rows.map((row) => row[0]));
    expect(ids.size).toBe(EVENT_COUNT);
  });

  it("omits the personal columns from the header AND the rows", async () => {
    const withPii = await drain(
      exportEvents({ query: OBJECT_PREFIX }, true, 1000),
    );
    const without = await drain(
      exportEvents({ query: OBJECT_PREFIX }, false, 1000),
    );

    expect(withPii.header).toContain("ip_address");
    expect(without.header).not.toContain("ip_address");
    expect(without.header).not.toContain("user_agent");

    // Not merely absent from the header: absent from the data. A row that
    // still carried the IP in an unlabelled column would pass a header check
    // and leak anyway.
    expect(withPii.rows.some((row) => row.includes("203.0.113.0"))).toBe(true);
    expect(without.rows.some((row) => row.includes("203.0.113.0"))).toBe(false);
    expect(without.rows.some((row) => row.includes("ExportSuite/1.0"))).toBe(
      false,
    );
  });

  it("applies the verb filter the screen applied", async () => {
    const { rows } = await drain(
      exportEvents(
        { verb: "auth.signed_in", query: OBJECT_PREFIX },
        false,
        1000,
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("auth.signed_in");
  });

  it("applies the group filter", async () => {
    const { rows } = await drain(
      exportEvents({ group: "lesson", query: OBJECT_PREFIX }, false, 1000),
    );
    expect(rows).toHaveLength(EVENT_COUNT);
  });

  it("applies the date window", async () => {
    const { rows } = await drain(
      exportEvents(
        {
          query: OBJECT_PREFIX,
          from: new Date(Date.UTC(2026, 2, 1, 0, 10)),
          to: new Date(Date.UTC(2026, 2, 1, 0, 14)),
        },
        false,
        1000,
      ),
    );
    expect(rows).toHaveLength(5);
  });

  it("stops at the cap rather than streaming the whole table", async () => {
    const { rows } = await drain(
      exportEvents({ query: OBJECT_PREFIX }, false, 4),
    );
    expect(rows).toHaveLength(4);
  });

  it("produces rows the CSV encoder can write without mangling them", async () => {
    const { header, rows } = await drain(
      exportEvents({ query: OBJECT_PREFIX }, true, 5),
    );
    const line = csvRow(rows[0]!);
    expect(line.endsWith("\r\n")).toBe(true);
    expect(line.split(",").length).toBeGreaterThanOrEqual(header.length);
  });
});

describe("exportAttempts", () => {
  it("exports one quiz's sittings with the candidate attached", async () => {
    const { header, rows } = await drain(
      exportAttempts({ quizSlug: QUIZ_SLUG }, 1000),
    );

    expect(rows).toHaveLength(1);
    const row = Object.fromEntries(header.map((key, i) => [key, rows[0]![i]]));
    expect(row.quiz_slug).toBe(QUIZ_SLUG);
    expect(row.user_email).toBe(`${ACTOR}@export.invalid`);
    expect(row.score).toBe("7");
    expect(row.percent).toBe("70");
    expect(row.passed).toBe("true");
  });

  it("scopes to the quiz asked for", async () => {
    const { rows } = await drain(
      exportAttempts({ quizSlug: `${QUIZ_SLUG}-nope` }, 1000),
    );
    expect(rows).toHaveLength(0);
  });
});

describe("exportFunnel", () => {
  it("writes a stage nothing emits as not-recorded rather than as zero", async () => {
    const { header, rows } = await drain(
      exportFunnel(
        new Date(Date.UTC(2026, 1, 1)),
        new Date(Date.UTC(2026, 3, 1)),
      ),
    );

    const notRecorded = header.indexOf("not_recorded");
    const people = header.indexOf("people");
    const lesson = rows.find((row) => row[0] === "lessonRead")!;

    expect(lesson[notRecorded]).toBe("true");
    // Blank, not "0". A spreadsheet reading 0 there would report that nobody
    // read a lesson, which is a claim the data cannot support.
    expect(lesson[people]).toBe("");
  });
});

describe("recentExportTimes", () => {
  it("counts only this actor's exports, and only inside the window", async () => {
    const now = new Date();
    await db.insert(schema.activityEvents).values([
      {
        id: uuidv7(),
        actorId: ACTOR,
        verb: "admin.exported",
        objectType: "export",
        objectId: "events",
        createdAt: new Date(now.getTime() - 60_000),
      },
      {
        id: uuidv7(),
        actorId: ACTOR,
        verb: "admin.exported",
        objectType: "export",
        objectId: "events",
        createdAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
      },
      {
        id: uuidv7(),
        actorId: OTHER,
        verb: "admin.exported",
        objectType: "export",
        objectId: "events",
        createdAt: new Date(now.getTime() - 60_000),
      },
    ]);

    const times = await recentExportTimes(
      ACTOR,
      new Date(now.getTime() - 60 * 60 * 1000),
    );
    expect(times).toHaveLength(1);
  });
});
