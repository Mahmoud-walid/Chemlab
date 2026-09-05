import "@/lib/load-env";
import { connect, seedUrl } from "@/db/seed/connect";

import { runRetention } from "@/db/queries/admin/retention";
import {
  EVENT_RETENTION_DAYS,
  PII_RETENTION_DAYS,
} from "@/lib/exports/retention";

/**
 * Enforces the activity retention windows.
 *
 *   pnpm retention              # delete and anonymise
 *   pnpm retention --dry-run    # report what would go, change nothing
 *   pnpm retention --event-days 365 --pii-days 30
 *
 * Where and how often it runs is recorded in docs/ACTIVITY.md. It is safe to
 * run twice, safe to run late, and safe to interrupt: every batch is chosen by
 * age, so an interrupted run simply leaves work for the next one.
 *
 * `--dry-run` first is the habit worth having. This is the one job in the
 * repository that deletes rows nobody can get back.
 */

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function days(name: string, fallback: number): number {
  const raw = arg(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    console.error(`--${name} must be a positive whole number of days.`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const url = seedUrl();
  if (!url) {
    console.error(
      "No database URL. Set DATABASE_URL_UNPOOLED or DATABASE_URL.",
    );
    process.exit(1);
  }

  const eventDays = days("event-days", EVENT_RETENTION_DAYS);
  const piiDays = days("pii-days", PII_RETENTION_DAYS);
  const dryRun = flag("dry-run");

  const { db, close } = connect(url);
  try {
    const run = await runRetention(db, { eventDays, piiDays, dryRun });

    const prefix = dryRun ? "retention (dry run):" : "retention:";
    console.log(
      `${prefix} ${run.deleted} event(s) older than ${eventDays}d ` +
        `${dryRun ? "would be deleted" : "deleted"}, ` +
        `${run.anonymised} row(s) older than ${piiDays}d ` +
        `${dryRun ? "would lose" : "lost"} IP and user agent.`,
    );
    console.log(
      `  delete before ${run.cutoffs.deleteBefore.toISOString()}, ` +
        `anonymise before ${run.cutoffs.anonymiseBefore.toISOString()}`,
    );

    if (run.truncated) {
      // Not a failure: the ceiling exists so a job pointed at years of backlog
      // finishes its window instead of running until something kills it.
      console.log("  batch ceiling reached — run again to continue.");
    }
  } finally {
    await close();
  }
}

void main();
