import "@/lib/load-env";
import { connect, seedUrl } from "@/db/seed/connect";

import { fanOut } from "@/lib/notifications/fanout";

/**
 * Turns queued notification events into rows and pushes.
 *
 *   pnpm notifications:fanout
 *
 * Runs alongside `pnpm push:drain` — this fills the push queue, that empties
 * it. Where and how often both run is the owner's call, documented in
 * docs/NOTIFICATIONS.md.
 *
 * Safe to run twice at once: events are claimed with `for update skip locked`,
 * so a second run skips what the first is holding rather than turning one
 * event into two notifications.
 */
async function main() {
  const url = seedUrl();
  if (!url) {
    console.error(
      "No database URL. Set DATABASE_URL_UNPOOLED or DATABASE_URL.",
    );
    process.exit(1);
  }

  const { db, close } = connect(url);
  try {
    const result = await fanOut(db);
    console.log(
      `fanout: ${result.events} event(s) — ${result.notifications} notification(s), ` +
        `${result.pushesQueued} push(es) queued, ${result.suppressed} suppressed, ` +
        `${result.failed} failed.`,
    );
  } finally {
    await close();
  }
}

void main();
