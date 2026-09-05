"use client";

import { useEffect, useRef } from "react";

import { HEARTBEAT_JITTER, HEARTBEAT_MS } from "@/lib/presence/constants";
import { nextBeatMs } from "@/lib/presence/state";
import { LeaderElection, broadcastTransport } from "@/lib/presence/leader";

/**
 * "I am still here", once a minute, from one tab.
 *
 * Four rules, each of which exists to stop a specific waste:
 *
 * 1. **Only while the tab is visible.** A hidden tab is not a person being
 *    present, and browsers throttle its timers anyway — so an abandoned open
 *    tab stops writing within one interval instead of for ever.
 * 2. **One tab, not five.** A `BroadcastChannel` election means five tabs
 *    produce one write per interval rather than five of the same fact.
 * 3. **Jittered.** Everybody's tab waking in the same second after a deploy is
 *    a thundering herd against one row each.
 * 4. **A final beacon on `pagehide`**, so somebody who closes the tab goes
 *    away promptly rather than looking online for two and a half minutes.
 *
 * Fire-and-forget throughout: a failed beat is never retried in a loop and
 * never surfaces. It is a green dot.
 */
export function usePresenceHeartbeat(enabled: boolean) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const transport = broadcastTransport("chemlab-presence");
    // No `BroadcastChannel` means every tab beats — wasteful but correct, and
    // better than no heartbeat at all.
    const election = transport
      ? new LeaderElection(
          `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          transport,
        )
      : null;
    election?.start();

    let stopped = false;

    /** The coarse route, never the URL. A query string carries whatever the
     * page put in it, which on a search page is what somebody typed. */
    const coarsePath = () =>
      window.location.pathname
        .replace(/^\/(en|ar)(?=\/|$)/, "")
        .replace(/\/[0-9a-f-]{8,}(?=\/|$)/gi, "/[id]")
        .replace(/\/[^/]{40,}(?=\/|$)/g, "/[slug]") || "/";

    const beat = () => {
      if (document.visibilityState !== "visible") return;
      if (election && !election.shouldBeat()) return;

      void fetch("/api/presence/beat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: coarsePath() }),
        keepalive: true,
      }).catch(() => {
        // Silence. A retry storm against a table every online user is writing
        // to is worse than a dot that is a minute stale.
      });
    };

    const schedule = () => {
      if (stopped) return;
      timer.current = setTimeout(
        () => {
          beat();
          schedule();
        },
        nextBeatMs(HEARTBEAT_MS, HEARTBEAT_JITTER),
      );
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        // Back at the desk: report in now rather than up to a minute later.
        beat();
      }
    };

    const onHide = () => {
      // `sendBeacon` survives the document being torn down, which a `fetch`
      // does not — this is the difference between going away promptly and
      // looking online until the window closes.
      navigator.sendBeacon?.(
        "/api/presence/beat",
        new Blob([JSON.stringify({ path: coarsePath() })], {
          type: "application/json",
        }),
      );
    };

    beat();
    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);

    return () => {
      stopped = true;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      election?.stop();
    };
  }, [enabled]);
}
