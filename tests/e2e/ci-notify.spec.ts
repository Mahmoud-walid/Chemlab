import { expect, test } from "@playwright/test";
import { createHmac, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import { connect, seedUrl, type SeedDatabase } from "@/db/seed/connect";

/**
 * The CI endpoint, against the running app.
 *
 * This is the one part of #24 that cannot be proven anywhere else: the
 * signature is computed by a shell script in a workflow and verified by a
 * route handler, and the two only meet over HTTP. A unit test of
 * `verifySignature` proves the function; this proves the ROUTE — that the raw
 * body reaches it unmodified, that a refusal is a bare 401, and that a retried
 * delivery does not notify twice.
 */

test.describe.configure({ timeout: 60_000 });

const SECRET = process.env.CI_NOTIFY_SECRET;
const REPO = "Mahmoud-walid/ci-e2e";

let db: SeedDatabase;
let close: () => Promise<void>;

test.beforeAll(() => {
  const url = seedUrl();
  if (!url) throw new Error("no database URL");
  ({ db, close } = connect(url));
});

test.afterAll(async () => {
  await db?.delete(schema.ciRuns).where(eq(schema.ciRuns.repository, REPO));
  await close?.();
});

let counter = 0;

function body(overrides: Record<string, unknown> = {}): string {
  counter += 1;
  return JSON.stringify({
    repository: REPO,
    branch: "main",
    job: "ci",
    commitSha: "a".repeat(40),
    commitMessage: "fix: something",
    actor: "Mahmoud-walid",
    outcome: "failure",
    failedJobs: ["verify"],
    runUrl: `https://github.com/${REPO}/actions/runs/${Date.now()}-${counter}`,
    timestamp: Math.floor(Date.now() / 1000),
    nonce: randomBytes(16).toString("hex"),
    ...overrides,
  });
}

/** The same construction the workflow's `openssl dgst` produces. */
function sign(raw: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
}

test.describe("POST /api/ci/notify", () => {
  test("refuses an unsigned request", async ({ request }) => {
    // Unauthenticated, this endpoint is a free spam cannon aimed at whoever
    // opted in.
    const response = await request.post("/api/ci/notify", {
      data: JSON.parse(body()),
    });
    expect(response.status()).toBe(401);
  });

  test("refuses a wrong signature, and says nothing about why", async ({
    request,
  }) => {
    const raw = body();
    const response = await request.post("/api/ci/notify", {
      headers: {
        "content-type": "application/json",
        "x-chemlab-signature": sign(raw, "not-the-secret-at-all-really"),
      },
      data: raw,
    });

    expect(response.status()).toBe(401);
    // Telling a caller which half failed tells an attacker which to work on.
    expect(await response.text()).not.toContain("signature");
    expect(await response.text()).not.toContain("timestamp");
  });

  test("refuses a body modified after signing", async ({ request }) => {
    test.skip(!SECRET, "needs CI_NOTIFY_SECRET");

    const raw = body();
    const signature = sign(raw, SECRET!);
    const tampered = JSON.stringify({
      ...JSON.parse(raw),
      branch: "attacker",
    });

    const response = await request.post("/api/ci/notify", {
      headers: {
        "content-type": "application/json",
        "x-chemlab-signature": signature,
      },
      data: tampered,
    });

    expect(response.status()).toBe(401);
  });

  test("refuses a signed request that is too old to be live", async ({
    request,
  }) => {
    test.skip(!SECRET, "needs CI_NOTIFY_SECRET");

    // Correctly signed, but captured an hour ago. The freshness window is
    // what makes a captured request worthless.
    const raw = body({ timestamp: Math.floor(Date.now() / 1000) - 3_600 });
    const response = await request.post("/api/ci/notify", {
      headers: {
        "content-type": "application/json",
        "x-chemlab-signature": sign(raw, SECRET!),
      },
      data: raw,
    });

    expect(response.status()).toBe(401);
  });

  test("accepts a signed run, and records it once", async ({ request }) => {
    test.skip(!SECRET, "needs CI_NOTIFY_SECRET");

    const raw = body();
    const headers = {
      "content-type": "application/json",
      "x-chemlab-signature": sign(raw, SECRET!),
    };

    const first = await request.post("/api/ci/notify", { headers, data: raw });
    expect(first.status()).toBe(202);
    // Nobody has opted in on a fresh database, which is the correct outcome
    // and not a failure: this is opt-in, and an absent row means never.
    expect(await first.json()).toMatchObject({ pushed: 0 });

    // A retried delivery: accepted, and does nothing.
    const again = await request.post("/api/ci/notify", { headers, data: raw });
    expect(again.status()).toBe(202);
    expect(await again.json()).toMatchObject({ duplicate: true });

    const rows = await db
      .select()
      .from(schema.ciRuns)
      .where(eq(schema.ciRuns.repository, REPO));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcome).toBe("failure");
    expect(rows[0]!.failedJobs).toEqual(["verify"]);
    // And it recorded why nobody was told.
    expect(rows[0]!.suppressionReason).toBe("not-opted-in");
  });

  test("answers a signed but malformed body with something actionable", async ({
    request,
  }) => {
    test.skip(!SECRET, "needs CI_NOTIFY_SECRET");

    // Signed means it is our own workflow sending something wrong, which
    // deserves a message rather than the silence an attacker gets.
    const raw = JSON.stringify({ ...JSON.parse(body()), outcome: "flaky" });
    const response = await request.post("/api/ci/notify", {
      headers: {
        "content-type": "application/json",
        "x-chemlab-signature": sign(raw, SECRET!),
      },
      data: raw,
    });

    expect(response.status()).toBe(400);
    expect(await response.text()).not.toBe("");
  });
});
