import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";
import * as schema from "@/db/schema";
import {
  alreadyRecorded,
  ciPreferencesFor,
  optedInRecipients,
  previousOutcome,
  recordRun,
  saveCiPreferences,
} from "@/db/queries/ci";
import { decideNotify, DEFAULT_CI_PREFERENCES } from "@/lib/ci/policy";
import { ciNotifyPayloadSchema, type CiNotifyPayload } from "@/lib/ci/payload";

/**
 * CI alerts, against real Postgres.
 *
 * The claims that need a database rather than a mock: the "back to green"
 * rule is a statement about what is IN the table, and the idempotency of a
 * retried delivery is a unique index — a check-then-insert would pass a mocked
 * test and send the same failure twice in production.
 */

let db: SeedDatabase;
let close: () => Promise<void>;

const REPO = `Mahmoud-walid/ci-test-${uuidv7()}`;
const DEV = `ci-dev-${uuidv7()}`;

beforeAll(async () => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));

  await db
    .insert(schema.users)
    .values({
      id: DEV,
      name: "CI Developer",
      email: `${DEV}@ci-test.invalid`,
    })
    .onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(schema.ciRuns).where(eq(schema.ciRuns.repository, REPO));
  await db.delete(schema.users).where(eq(schema.users.id, DEV));
  await close?.();
});

beforeEach(async () => {
  await db.delete(schema.ciRuns).where(eq(schema.ciRuns.repository, REPO));
  await db
    .delete(schema.ciNotificationPreferences)
    .where(eq(schema.ciNotificationPreferences.userId, DEV));
});

let runCounter = 0;

function payload(overrides: Partial<CiNotifyPayload> = {}): CiNotifyPayload {
  runCounter += 1;
  return ciNotifyPayloadSchema.parse({
    repository: REPO,
    branch: "main",
    job: "verify",
    commitSha: uuidv7().replaceAll("-", "").padEnd(40, "0").slice(0, 40),
    commitMessage: "fix: a thing",
    actor: "Mahmoud-walid",
    outcome: "failure",
    failedJobs: ["verify"],
    runUrl: `https://github.com/${REPO}/actions/runs/${runCounter}`,
    timestamp: Math.floor(Date.now() / 1000),
    nonce: uuidv7(),
    ...overrides,
  });
}

const quiet = { notified: false, suppressionReason: null, pushesQueued: 0 };

describe("the previous outcome", () => {
  it("is null before anything is recorded", async () => {
    // Treated as "no red to recover from" rather than as a recovery, or every
    // repository announces itself once for no reason.
    expect(await previousOutcome(db, REPO, "main", "verify")).toBeNull();
  });

  it("is the most recent run on that branch and job", async () => {
    await recordRun(db, payload({ outcome: "failure" }), quiet);
    await recordRun(db, payload({ outcome: "success" }), quiet);

    expect(await previousOutcome(db, REPO, "main", "verify")).toBe("success");
  });

  it("does not read across jobs", async () => {
    // `e2e` going red does not mean `verify` did, and a recovery is a
    // statement about one of them at a time.
    await recordRun(db, payload({ job: "e2e", outcome: "failure" }), quiet);

    expect(await previousOutcome(db, REPO, "main", "verify")).toBeNull();
    expect(await previousOutcome(db, REPO, "main", "e2e")).toBe("failure");
  });

  it("does not read across branches", async () => {
    await recordRun(
      db,
      payload({ branch: "feat/x", outcome: "failure" }),
      quiet,
    );
    expect(await previousOutcome(db, REPO, "main", "verify")).toBeNull();
  });
});

describe("a retried delivery", () => {
  it("is recorded once, so nobody is told twice", async () => {
    // GitHub retries deliveries and a workflow can be re-run. Without the
    // unique index this is a second buzz for a failure already seen — and the
    // dedupe has to be a constraint, because two retries arriving together
    // would both see no row.
    const run = payload();

    expect((await recordRun(db, run, quiet)).inserted).toBe(true);
    expect((await recordRun(db, run, quiet)).inserted).toBe(false);

    const rows = await db
      .select()
      .from(schema.ciRuns)
      .where(eq(schema.ciRuns.repository, REPO));
    expect(rows).toHaveLength(1);
  });

  it("is visible to the endpoint before it does any work", async () => {
    const run = payload();
    expect(await alreadyRecorded(db, REPO, run.runUrl, run.job)).toBe(false);
    await recordRun(db, run, quiet);
    expect(await alreadyRecorded(db, REPO, run.runUrl, run.job)).toBe(true);
  });

  it("distinguishes the same run URL on different jobs", async () => {
    // The five jobs of one workflow run share a run URL. Deduping on the URL
    // alone would silence four of them.
    const url = `https://github.com/${REPO}/actions/runs/shared`;
    await recordRun(db, payload({ runUrl: url, job: "verify" }), quiet);

    expect(
      (await recordRun(db, payload({ runUrl: url, job: "e2e" }), quiet))
        .inserted,
    ).toBe(true);
  });
});

describe("what the row remembers", () => {
  it("records why nobody was told", async () => {
    // "Why did nobody get paged?" should be answerable from the table rather
    // than by re-reading the policy.
    await recordRun(db, payload(), {
      notified: false,
      suppressionReason: "not-opted-in",
      pushesQueued: 0,
    });

    const [row] = await db
      .select()
      .from(schema.ciRuns)
      .where(eq(schema.ciRuns.repository, REPO));

    expect(row!.notified).toBe(false);
    expect(row!.suppressionReason).toBe("not-opted-in");
  });

  it("separates 'the policy said no' from 'nobody has a device'", async () => {
    // Zero pushes with `notified` true is a different problem from the policy
    // suppressing the run, and the two look identical without both columns.
    await recordRun(db, payload(), {
      notified: true,
      suppressionReason: null,
      pushesQueued: 0,
    });

    const [row] = await db
      .select()
      .from(schema.ciRuns)
      .where(eq(schema.ciRuns.repository, REPO));

    expect(row!.notified).toBe(true);
    expect(row!.pushesQueued).toBe(0);
    expect(row!.suppressionReason).toBeNull();
  });
});

describe("opting in", () => {
  it("defaults to off for a developer with no row", async () => {
    // An absent row means never. The alternative — treating absence as
    // consent — is how a monitoring feature becomes a spam source.
    expect(await ciPreferencesFor(db, DEV)).toEqual(DEFAULT_CI_PREFERENCES);
    expect(await optedInRecipients(db)).not.toContainEqual(
      expect.objectContaining({ userId: DEV }),
    );
  });

  it("appears in the recipient list once enabled, and not before", async () => {
    await saveCiPreferences(db, DEV, { enabled: true });

    const recipients = await optedInRecipients(db);
    const mine = recipients.find((r) => r.userId === DEV);

    expect(mine).toBeDefined();
    expect(mine!.preferences.branches).toEqual(["main"]);
    expect(mine!.preferences.successPolicy).toBe("recovery");
  });

  it("keeps the fields a patch did not carry", async () => {
    await saveCiPreferences(db, DEV, { enabled: true, branches: ["*"] });
    const after = await saveCiPreferences(db, DEV, { notifyOnCancelled: true });

    expect(after.branches).toEqual(["*"]);
    expect(after.enabled).toBe(true);
    expect(after.notifyOnCancelled).toBe(true);
  });
});

describe("back to green, end to end", () => {
  it("stays quiet while green and speaks up when it recovers", async () => {
    await saveCiPreferences(db, DEV, { enabled: true });
    const [recipient] = await optedInRecipients(db);
    const preferences = recipient!.preferences;

    // A first green: nothing to recover from.
    const first = payload({ outcome: "success", failedJobs: [] });
    expect(
      decideNotify(
        "success",
        await previousOutcome(db, REPO, "main", "verify"),
        "main",
        preferences,
      ).notify,
    ).toBe(false);
    await recordRun(db, first, quiet);

    // A failure: always.
    expect(
      decideNotify(
        "failure",
        await previousOutcome(db, REPO, "main", "verify"),
        "main",
        preferences,
      ).notify,
    ).toBe(true);
    await recordRun(db, payload({ outcome: "failure" }), quiet);

    // And the green after it: the one success worth hearing about.
    const recovery = decideNotify(
      "success",
      await previousOutcome(db, REPO, "main", "verify"),
      "main",
      preferences,
    );
    expect(recovery).toEqual({ notify: true, reason: null, recovery: true });
  });
});
