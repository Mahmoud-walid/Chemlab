/* global self, fetch, URL, console */

/**
 * Chemlab's service worker.
 *
 * Hand-written and served from the origin root so its scope covers the whole
 * site. It does three things and no caching: a generated worker would add a
 * plugin, a build step and an offline strategy nobody asked for.
 *
 * The decisions here are mirrored — with tests — in
 * `lib/push/service-worker-logic.ts`. This file cannot import from it: it is
 * served as-is, not compiled. `tests/lib/service-worker.test.ts` asserts the
 * two agree, so a change to one that is not made to the other fails there
 * rather than in a browser nobody is watching.
 *
 * Bump SW_VERSION when this file changes. It is logged on activate, so
 * "which worker is actually running" is answerable from a user's console
 * rather than inferred.
 */

const SW_VERSION = "1";

const FALLBACK = {
  title: "Chemlab",
  body: "You have a new notification.",
  icon: "/icons/icon-192.png",
  badge: "/icons/badge-72.png",
  renotify: false,
  data: { url: "/" },
};

/** Only paths on our own origin. A notification looks like it came from the
 * site, so a payload that could open any URL would be a phishing primitive. */
function safeUrl(url, origin) {
  try {
    const resolved = new URL(url, origin);
    if (resolved.origin !== new URL(origin).origin) return "/";
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return "/";
  }
}

/** Never throws: there is no error surface inside a `push` event, and a
 * thrown exception simply loses the notification. */
function toNotification(raw, origin) {
  if (!raw) return FALLBACK;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return FALLBACK;
  }

  if (
    !payload ||
    typeof payload.title !== "string" ||
    payload.title.length === 0 ||
    typeof payload.body !== "string" ||
    payload.body.length === 0
  ) {
    return FALLBACK;
  }

  return {
    title: payload.title,
    body: payload.body,
    icon: payload.icon || FALLBACK.icon,
    badge: payload.badge || FALLBACK.badge,
    tag: payload.tag,
    renotify: payload.renotify === true,
    data: {
      ...(payload.data || {}),
      url: safeUrl(payload.url || "/", origin),
    },
  };
}

self.addEventListener("install", () => {
  // Take over immediately rather than waiting for every tab to close. A stale
  // worker running indefinitely is the classic failure mode of this feature.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.info(`[sw] version ${SW_VERSION} active`);
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  // `event.data` is null for the empty pushes some services send as a
  // wake-up. Reading `.text()` on null would throw and lose the event.
  const raw = event.data ? event.data.text() : null;
  const spec = toNotification(raw, self.location.origin);

  event.waitUntil(
    self.registration.showNotification(spec.title, {
      body: spec.body,
      icon: spec.icon,
      badge: spec.badge,
      tag: spec.tag,
      renotify: spec.renotify,
      data: spec.data,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = (event.notification.data && event.notification.data.url) || "/";
  const origin = self.location.origin;

  event.waitUntil(
    (async () => {
      // `includeUncontrolled` matters: a tab opened before this worker took
      // over is still a tab the reader has open, and opening a second copy of
      // the site is how somebody loses their place.
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      const ours = clients.filter((client) => {
        try {
          return new URL(client.url).origin === origin;
        } catch {
          return false;
        }
      });

      const target = ours.find((client) => client.focused) || ours[0];
      if (target) {
        await target.focus();
        if ("navigate" in target) await target.navigate(url);
        return;
      }

      await self.clients.openWindow(url);
    })(),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  // Browsers rotate endpoints. Without this the old one stays in our table,
  // every send to it 410s, and the user quietly stops receiving anything.
  event.waitUntil(
    (async () => {
      const applicationServerKey =
        (event.oldSubscription && event.oldSubscription.options
          ? event.oldSubscription.options.applicationServerKey
          : null) || null;

      if (!applicationServerKey) return;

      const subscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      await fetch("/api/push/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
    })(),
  );
});
