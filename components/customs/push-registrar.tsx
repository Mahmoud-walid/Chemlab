"use client";

import { useEffect } from "react";

/**
 * Registers the service worker, and keeps it fresh.
 *
 * Registration alone is the easy half. The hard half is that a browser caches
 * `sw.js` and, once a worker is installed, keeps running the OLD copy
 * indefinitely — which surfaces as "push stopped working for some people"
 * rather than as a caching bug. Three things together prevent that:
 *
 * 1. `next.config.ts` serves `/sw.js` with `Cache-Control: no-cache`.
 * 2. `sw.js` calls `skipWaiting()` and `clients.claim()`, so a new worker takes
 *    over immediately instead of waiting for every tab to close.
 * 3. This calls `registration.update()` on load and whenever the tab becomes
 *    visible again — a tab left open for a week is otherwise a tab running
 *    last week's worker.
 *
 * It registers and nothing else: no permission is requested here. #17 is
 * explicit that a prompt belongs on a user gesture at a moment that explains
 * itself, and a prompt on first paint is the single most reliable way to be
 * refused for ever.
 */
export function PushRegistrar() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    let registration: ServiceWorkerRegistration | undefined;

    const check = () => {
      if (document.visibilityState === "visible") void registration?.update();
    };

    void navigator.serviceWorker
      .register("/sw.js")
      .then((result) => {
        registration = result;
        return result.update();
      })
      // Registration failing is not a user-facing problem: everything except
      // push works without it, and an error toast about a service worker is
      // noise to somebody who never asked for notifications.
      .catch(() => {});

    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, []);

  return null;
}
