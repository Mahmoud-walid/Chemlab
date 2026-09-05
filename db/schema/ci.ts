import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { id } from "./_shared";
import { users } from "./auth";

/**
 * CI alerts: what each run did, and who asked to hear about it.
 *
 * The reason this needs a table at all is the noise policy. "Alert on every
 * failure, but on success only the first green after a red" is a statement
 * about the PREVIOUS run, and there is nowhere else to learn it — GitHub's
 * webhook says what this run did, not what the last one did.
 */

export const ciOutcome = pgEnum("ci_outcome", [
  "success",
  "failure",
  "cancelled",
]);

export const ciRuns = pgTable(
  "ci_runs",
  {
    id: id(),
    repository: text("repository").notNull(),
    branch: text("branch").notNull(),
    /** The job within the workflow. Five of them run on every push, and a
     * failure that does not say which is a message that sends you to the
     * browser anyway. */
    job: text("job").notNull().default("ci"),
    commitSha: text("commit_sha").notNull(),
    commitMessage: text("commit_message").notNull().default(""),
    outcome: ciOutcome("outcome").notNull(),
    /** Which jobs failed. A list: more than one of the five can fail in the
     * same run, and recording only the first would misreport the others. */
    failedJobs: jsonb("failed_jobs")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    actor: text("actor"),
    runUrl: text("run_url").notNull(),
    pullRequestNumber: integer("pull_request_number"),
    durationSeconds: integer("duration_seconds"),

    /** Whether anybody was actually told, and why not. Recorded so "why did
     * nobody get paged?" is answerable from the database rather than by
     * re-reading the policy. */
    notified: boolean("notified").notNull().default(false),
    suppressionReason: text("suppression_reason"),
    /** How many devices were queued. Zero with `notified` true means the
     * policy said yes and nobody has a subscription — a different problem
     * from the policy saying no. */
    pushesQueued: integer("pushes_queued").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The policy's only query: the previous outcome on this branch.
    index("ci_runs_branch_idx").on(t.repository, t.branch, t.createdAt.desc()),
    /**
     * One row per run attempt, not per POST.
     *
     * GitHub retries a delivery and a workflow can be re-run, and the run URL
     * is what identifies the attempt. Without this a retried delivery is a
     * second notification for a failure the reader already saw — and the
     * dedupe has to be a database constraint rather than a check-then-insert,
     * because two retries arriving together would both see nothing.
     */
    uniqueIndex("ci_runs_run_idx").on(t.repository, t.runUrl, t.job),
  ],
);

/**
 * Per-developer opt-in. **An absent row means no CI notifications, ever.**
 *
 * Deliberately not a role check: having admin rights is not a request to be
 * woken by a build, and somebody who wants build alerts should not have to be
 * granted admin to get them.
 */
export const ciNotificationPreferences = pgTable(
  "ci_notification_preferences",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    /** `["*"]` is every branch. The default is `main` alone: a red `main` is
     * the emergency, everything else is opt-in on top of it. */
    branches: jsonb("branches")
      .$type<string[]>()
      .notNull()
      .default(sql`'["main"]'::jsonb`),
    notifyOnFailure: boolean("notify_on_failure").notNull().default(true),
    /** `recovery` — the first green after a red — is the default. See
     * lib/ci/policy.ts for why "always" trains people to ignore the channel. */
    successPolicy: text("success_policy", {
      enum: ["never", "recovery", "always"],
    })
      .notNull()
      .default("recovery"),
    notifyOnCancelled: boolean("notify_on_cancelled").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);
