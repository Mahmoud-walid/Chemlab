import "@/lib/load-env";
import { connect, seedUrl } from "@/db/seed/connect";

import { drain } from "@/lib/push/send";
import { pruneFinished } from "@/lib/push/queue";

/**
 * Sends the pushes waiting in the queue.
 *
 *   pnpm push:drain              # one batch
 *   pnpm push:drain --limit 500  # a bigger batch, for clearing a backlog
 *
 * Where and how often this runs is the owner's call, documented in
 * docs/NOTIFICATIONS.md — a host cron, a scheduled GitHub Action, or by hand.
 * The honest cost of a queue is latency: a notification is as late as the gap
 * between drains. For a like or a reply that is fine.
 *
 * Safe to run twice at once: the claim uses `for update skip locked`, so a
 * second drain skips the rows the first is holding rather than sending them
 * again.
 */

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** Finished rows are kept this long, so "I never got it" can be answered. */
const KEEP_FINISHED_DAYS = 7;

async function main() {
  const url = seedUrl();
  if (!url) {
    console.error(
      "No database URL. Set DATABASE_URL_UNPOOLED or DATABASE_URL.",
    );
    process.exit(1);
  }

  const limitRaw = arg("limit");
  const limit = limitRaw === undefined ? undefined : Number(limitRaw);
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    console.error("--limit must be a positive whole number.");
    process.exit(1);
  }

  const { db, close } = connect(url);
  try {
    const result = await drain(db, { limit });

    console.log(
      `push: ${result.attempted} claimed — ${result.sent} sent, ` +
        `${result.retried} to retry, ${result.expired} expired, ` +
        `${result.failed} failed.`,
    );
    if (result.prunedSubscriptions > 0) {
      console.log(
        `  pruned ${result.prunedSubscriptions} subscription(s) that keep failing.`,
      );
    }

    const pruned = await pruneFinished(
      db,
      new Date(Date.now() - KEEP_FINISHED_DAYS * 24 * 60 * 60 * 1000),
    );
    if (pruned > 0) console.log(`  removed ${pruned} finished row(s).`);
  } finally {
    await close();
  }
}

void main();
