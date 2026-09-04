/**
 * Proves the seeded database matches the JSON in `data/`, field by field.
 *
 *   pnpm db:verify
 *
 * Exits non-zero on any mismatch, listing every one rather than the first.
 */
import "@/lib/load-env";
import { connect, seedUrl } from "@/db/seed/connect";
import { verifyContent } from "@/db/seed/verify";

async function main() {
  const url = seedUrl();
  if (!url) {
    console.error(
      "Set DATABASE_URL_UNPOOLED (preferred) or DATABASE_URL before verifying.",
    );
    process.exit(1);
  }

  const { db, close } = connect(url);
  try {
    const problems = await verifyContent(db);
    if (problems.length === 0) {
      console.log("content matches data/ — every field, not just the counts");
      return;
    }
    console.error(`${problems.length} mismatch(es):\n`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
  } finally {
    await close();
  }
}

void main();
