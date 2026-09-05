"use client";

import { useQuery } from "@tanstack/react-query";

import { MAX_PRESENCE_IDS, ONLINE_WINDOW_MS } from "@/lib/presence/constants";
import type { PresenceState } from "@/lib/presence/state";

/**
 * Presence for the people currently on screen.
 *
 * One query per SET of ids, keyed by the sorted ids, so a page of forty
 * avatars issues one request rather than forty — and React Query dedupes any
 * component asking for the same set.
 *
 * On failure it returns `unknown`, never `offline`. Presence is ABSENT when
 * the store cannot be reached; rendering a grey "offline" dot because a
 * request timed out is a claim about somebody with no basis.
 */

export interface PresenceEntry {
  state: PresenceState;
  lastSeenAt: string | null;
  lastPath: string | null;
}

export function usePresence(
  userIds: readonly (string | null | undefined)[],
): Map<string, PresenceEntry> {
  // Sorted and deduped so two components asking for the same people in a
  // different order share one cache entry rather than issuing two requests.
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))]
    .sort()
    .slice(0, MAX_PRESENCE_IDS);

  const query = useQuery({
    queryKey: ["presence", ids],
    enabled: ids.length > 0,
    // Matched to the window: refetching faster than the state can change is
    // load with no new information.
    staleTime: ONLINE_WINDOW_MS / 2,
    refetchInterval: ONLINE_WINDOW_MS / 2,
    // A dot is not worth a retry storm against a table every online user is
    // writing to.
    retry: false,
    queryFn: async () => {
      const response = await fetch(
        `/api/presence?userIds=${encodeURIComponent(ids.join(","))}`,
      );
      if (!response.ok) throw new Error(String(response.status));
      return (await response.json()) as {
        rows: ({ userId: string } & PresenceEntry)[];
      };
    },
  });

  const map = new Map<string, PresenceEntry>();
  if (!query.data) return map;

  for (const row of query.data.rows) {
    map.set(row.userId, {
      state: row.state,
      lastSeenAt: row.lastSeenAt,
      lastPath: row.lastPath,
    });
  }
  return map;
}
