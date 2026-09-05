import { describe, expect, it } from "vitest";

import { toPushPayload, toSlackMessage } from "@/lib/ci/render";
import { ciNotifyPayloadSchema, type CiNotifyPayload } from "@/lib/ci/payload";
import {
  BODY_MAX,
  TITLE_MAX,
  notificationPayloadSchema,
} from "@/lib/push/payload";

/**
 * Both renderings come from one payload, so the assertions live together: a
 * change that improves the Slack message and forgets the push is exactly what
 * this file exists to fail on.
 */

function run(overrides: Partial<CiNotifyPayload> = {}): CiNotifyPayload {
  return ciNotifyPayloadSchema.parse({
    repository: "Mahmoud-walid/Chemlab",
    branch: "main",
    commitSha: "abc1234def5678901234567890abcdef12345678",
    commitMessage: "fix(ci): stop the drift\n\nA body.",
    actor: "Mahmoud-walid",
    job: "verify",
    outcome: "failure",
    failedJobs: ["verify"],
    runUrl: "https://github.com/Mahmoud-walid/Chemlab/actions/runs/42",
    durationSeconds: 95,
    timestamp: 1_800_000_000,
    nonce: "0123456789abcdef",
    ...overrides,
  });
}

describe("the push notification", () => {
  it("names the job and the branch, not just 'CI'", () => {
    // The workflow has five jobs. "CI failed" that does not say which sends
    // you to the browser anyway, which is what the notification was meant to
    // save you.
    const push = toPushPayload(run(), false);
    expect(push.title).toContain("verify");
    expect(push.title).toContain("main");
  });

  it("leads with the failing jobs, all of them", () => {
    // More than one of the five can fail in the same run. Naming only the
    // first would send somebody to fix `verify` while `e2e` is still red.
    expect(toPushPayload(run(), false).body).toContain("verify");
    expect(
      toPushPayload(run({ failedJobs: ["verify", "e2e"] }), false).body,
    ).toContain("verify, e2e");
  });

  it("says 'back to green' rather than 'passed' on a recovery", () => {
    // The one success worth a buzz. Calling it "passed" buries the news.
    expect(toPushPayload(run({ outcome: "success" }), true).title).toContain(
      "back to green",
    );
    expect(toPushPayload(run({ outcome: "success" }), false).title).toContain(
      "passed",
    );
  });

  it("clicks through to the run, not the repository", () => {
    // Somebody woken by a failure wants the log.
    const push = toPushPayload(run(), false);
    expect(push.url).toBe(
      "https://github.com/Mahmoud-walid/Chemlab/actions/runs/42",
    );
  });

  it("collapses a branch's runs into one tray entry, and still buzzes", () => {
    // Six failures from six pushes to one branch is six taps to reach the one
    // that matters — and the fifth is stale by the time it is read. But a NEW
    // failure is a different commit, so replacing silently would look like
    // nothing happened.
    const push = toPushPayload(run(), false);
    expect(push.tag).toBe("ci:Mahmoud-walid/Chemlab:main:verify");
    expect(push.renotify).toBe(true);
    expect(toPushPayload(run({ branch: "feat/x" }), false).tag).not.toBe(
      push.tag,
    );
  });

  it("keeps two long branches apart rather than truncating them together", () => {
    // Truncating a tag at the cap would give two branches sharing a prefix the
    // SAME tag, and one would silently replace the other in the tray — a
    // failure on a branch you are not looking at eating the one you are.
    const a = toPushPayload(
      run({ branch: `feat/${"a".repeat(200)}-one` }),
      false,
    );
    const b = toPushPayload(
      run({ branch: `feat/${"a".repeat(200)}-two` }),
      false,
    );

    expect(a.tag!.length).toBeLessThanOrEqual(64);
    expect(a.tag).not.toBe(b.tag);
    // Stable across calls: a dedup key that changed per run would dedup
    // nothing.
    expect(a.tag).toBe(
      toPushPayload(run({ branch: `feat/${"a".repeat(200)}-one` }), false).tag,
    );
  });

  it("fits what a push service will accept", () => {
    // A long branch name and a long commit subject together are the realistic
    // way to overflow this, and a 413 arrives long after the code that built
    // the payload returned.
    const push = toPushPayload(
      run({
        branch: "feat/" + "a".repeat(200),
        commitMessage: "b".repeat(200),
      }),
      false,
    );

    expect(push.title.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(push.body.length).toBeLessThanOrEqual(BODY_MAX);
    // And it is still a valid payload, not merely a short one.
    expect(notificationPayloadSchema.safeParse(push).success).toBe(true);
  });
});

describe("the Slack message", () => {
  it("carries a fallback text as well as blocks", () => {
    // `text` is what Slack shows in the notification, the sidebar and to a
    // screen reader. Blocks alone read as "This content can't be displayed"
    // in exactly those places.
    const message = toSlackMessage(run(), false);
    expect(message.text.length).toBeGreaterThan(0);
    expect(message.blocks.length).toBeGreaterThan(0);
  });

  it("links the run behind a button, not as a raw URL", () => {
    const message = toSlackMessage(run(), false);
    const serialised = JSON.stringify(message.blocks);

    expect(serialised).toContain('"type":"button"');
    expect(serialised).toContain("View run");
    expect(serialised).toContain("/actions/runs/42");
    // Red, so the outcome is visible without reading.
    expect(serialised).toContain('"style":"danger"');
  });

  it("adds a pull-request button only when there is a pull request", () => {
    expect(JSON.stringify(toSlackMessage(run(), false).blocks)).not.toContain(
      "PR #",
    );
    expect(
      JSON.stringify(
        toSlackMessage(run({ pullRequestNumber: 89 }), false).blocks,
      ),
    ).toContain("PR #89");
  });

  it("names the failing step for a failure and nothing for a success", () => {
    expect(JSON.stringify(toSlackMessage(run(), false).blocks)).toContain(
      "Failed job:",
    );
    // Plural when there are several, because "Failed job: verify, e2e" reads
    // as one job with a strange name.
    expect(
      JSON.stringify(
        toSlackMessage(run({ failedJobs: ["verify", "e2e"] }), false).blocks,
      ),
    ).toContain("Failed jobs:");
    expect(
      JSON.stringify(
        toSlackMessage(run({ outcome: "success", failedJobs: [] }), true)
          .blocks,
      ),
    ).not.toContain("Failed job");
  });

  it("shows the branch, the commit and who pushed it", () => {
    const serialised = JSON.stringify(toSlackMessage(run(), false).blocks);
    expect(serialised).toContain("main");
    // The short sha, linked to the commit.
    expect(serialised).toContain("abc1234");
    expect(serialised).toContain(
      "/commit/abc1234def5678901234567890abcdef12345678",
    );
    expect(serialised).toContain("Mahmoud-walid");
    // And how long it took, in something a person reads.
    expect(serialised).toContain("1m 35s");
  });

  it("marks each outcome differently", () => {
    expect(toSlackMessage(run(), false).text).toContain("❌");
    expect(
      toSlackMessage(run({ outcome: "success", failedJobs: [] }), false).text,
    ).toContain("✅");
    expect(
      toSlackMessage(run({ outcome: "cancelled", failedJobs: [] }), false).text,
    ).toContain("⚪");
  });
});
