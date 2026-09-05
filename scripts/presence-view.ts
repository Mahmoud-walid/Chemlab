import "@/lib/load-env";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  AWAY_WINDOW_SECONDS,
  ONLINE_WINDOW_SECONDS,
} from "@/lib/presence/constants";

/**
 * Generates the presence view's SQL from the constants.
 *
 * The client's flicker tolerance and the server's window must agree, and two
 * hand-written copies of "150 seconds" is one of them going stale. This writes
 * the view; `tests/integration/presence.test.ts` asserts the migration on disk
 * still matches what this produces, so a change to the constants that forgets
 * the migration fails there rather than in production.
 */

export function presenceViewSql(): string {
  return `CREATE OR REPLACE VIEW presence_state AS
SELECT p.user_id,
       CASE
         WHEN u.presence_visibility = 'nobody' THEN 'offline'
         WHEN now() - p.last_seen_at < interval '${ONLINE_WINDOW_SECONDS} seconds' THEN 'online'
         WHEN now() - p.last_seen_at < interval '${AWAY_WINDOW_SECONDS} seconds' THEN 'away'
         ELSE 'offline'
       END AS state,
       CASE
         WHEN u.presence_visibility = 'nobody' THEN NULL
         ELSE p.last_seen_at
       END AS last_seen_at,
       p.last_path
FROM user_presence p
JOIN users u ON u.id = p.user_id;`;
}

/** Run directly to print it, for pasting into a migration. */
if (process.argv[1]?.endsWith("presence-view.ts")) {
  const target = process.argv[2];
  if (target) {
    const file = path.resolve(target);
    const existing = readFileSync(file, "utf8");
    writeFileSync(
      file,
      `${existing.trimEnd()}\n--> statement-breakpoint\n${presenceViewSql()}\n`,
    );
    console.log(`appended the presence view to ${target}`);
  } else {
    console.log(presenceViewSql());
  }
}
