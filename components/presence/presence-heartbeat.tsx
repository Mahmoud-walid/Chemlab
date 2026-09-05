"use client";

import { useSession } from "@/lib/auth-client";
import { usePresenceHeartbeat } from "@/hooks/use-presence-heartbeat";

/**
 * Mounts the heartbeat for a signed-in reader.
 *
 * Read in the browser, not passed from a layout: most pages are prerendered,
 * so a server-rendered answer would be the answer at BUILD time — every reader
 * treated as signed out, and nobody ever reporting in.
 *
 * Renders nothing. It is one `fetch` a minute from one tab.
 */
export function PresenceHeartbeat() {
  const { data: session } = useSession();
  usePresenceHeartbeat(Boolean(session?.user));
  return null;
}
