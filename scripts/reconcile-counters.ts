import "@/lib/load-env";
import { connect, seedUrl } from "@/db/seed/connect";

import { findCounterDrift, repairCounters } from "@/db/queries/counters";

/**
 * Checks the denormalised lesson counters against their source tables.
 *
 *   pnpm reconcile           # report drift, exit 1 if any
 *   pnpm reconcile --repair  # recompute every counter from source
 *
 * Run in CI against a seeded database, and available to run by hand. Exits
 * non-zero on drift on purpose: a counter that disagrees with its source means
 * something wrote around a trigger, and that is a thing to look at rather than
 * a number to quietly correct.
 */

async function main() {
  const url = seedUrl();
  if (!url) {
    console.error(
      "No database URL. Set DATABASE_URL_UNPOOLED or DATABASE_URL.",
    );
    process.exit(1);
  }

  const repair = process.argv.includes("--repair");
  const { db, close } = connect(url);

  try {
    if (repair) {
      await repairCounters(db);
      console.log("counters: recomputed from source.");
    }

    const drift = await findCounterDrift(db);

    if (drift.length === 0) {
      console.log("counters: no drift.");
      return;
    }

    console.error(`counters: ${drift.length} column(s) disagree with source.`);
    for (const row of drift) {
      console.error(
        `  ${row.slug}.${row.column}: stored ${row.stored}, actual ${row.actual}`,
      );
    }
    console.error("Run `pnpm reconcile --repair` once you know why.");
    process.exitCode = 1;
  } finally {
    await close();
  }
}

void main();
