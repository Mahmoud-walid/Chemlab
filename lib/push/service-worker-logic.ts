import { notificationPayloadSchema, safeNotificationUrl } from "./payload";

/**
 * What the service worker decides, extracted so it can be tested.
 *
 * `public/sw.js` is plain JavaScript served from the origin root — it cannot
 * import from here, and it is not compiled. So the RULES live in this module
 * with tests, and `sw.js` holds the event wiring and a copy of the small
 * amount of logic it needs. A `tests/lib/service-worker.test.ts` asserts the
 * two agree.
 *
 * That duplication is deliberate and bounded. The alternative — a build step
 * that bundles a service worker — adds a plugin, a generated file, and a
 * caching layer nobody asked for, to a Next 16 + Turbopack setup where those
 * plugins are not something to bet the build on.
 */

/** What the worker shows when a push arrives. */
export interface NotificationSpec {
  title: string;
  body: string;
  icon: string;
  badge: string;
  tag?: string;
  renotify: boolean;
  data: { url: string } & Record<string, unknown>;
}

/**
 * The generic notification shown when a push carries nothing usable.
 *
 * Some push services send an EMPTY push as a wake-up, and a worker that throws
 * on one is a worker whose `push` handler is dead for the rest of that event.
 * A vague notification is bad; a silent failure the user attributes to us
 * never sending anything is worse.
 */
export const FALLBACK: NotificationSpec = {
  title: "Chemlab",
  body: "You have a new notification.",
  icon: "/icons/icon-192.png",
  badge: "/icons/badge-72.png",
  renotify: false,
  data: { url: "/" },
};

/**
 * Turns a raw push into something to show. Never throws: every failure path
 * ends at the fallback, because there is no user-visible error surface inside
 * a `push` event and a thrown exception simply loses the notification.
 */
export function toNotification(
  raw: string | null | undefined,
  origin: string,
): NotificationSpec {
  if (!raw) return FALLBACK;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return FALLBACK;
  }

  const result = notificationPayloadSchema.safeParse(parsed);
  if (!result.success) return FALLBACK;

  const payload = result.data;
  return {
    title: payload.title,
    body: payload.body,
    icon: payload.icon,
    badge: payload.badge,
    tag: payload.tag,
    renotify: payload.renotify,
    // Re-checked here even though the sender checked it: the worker is the
    // last thing between a payload and a navigation, and it is the only check
    // that runs on the machine doing the navigating.
    data: { ...payload.data, url: safeNotificationUrl(payload.url, origin) },
  };
}

/** A window the worker could focus, reduced to what the decision needs. */
export interface ClientWindow {
  url: string;
  focused: boolean;
}

export type ClickAction =
  /** Focus this window and navigate it. */
  | { kind: "focus"; index: number; url: string }
  /** Nothing suitable is open. */
  | { kind: "open"; url: string };

/**
 * What to do when a notification is clicked.
 *
 * Focusing an existing tab beats opening a new one: a reader who has Chemlab
 * open and taps a notification should not end up with two copies of the site,
 * one of which they will later close and lose their place in.
 *
 * Prefers an already-focused window, then any window on our origin. Anything
 * on another origin is not ours to navigate.
 */
export function decideClick(
  clients: readonly ClientWindow[],
  url: string,
  origin: string,
): ClickAction {
  const ours = clients
    .map((client, index) => ({ client, index }))
    .filter(({ client }) => sameOrigin(client.url, origin));

  if (ours.length === 0) return { kind: "open", url };

  const focused = ours.find(({ client }) => client.focused) ?? ours[0]!;
  return { kind: "focus", index: focused.index, url };
}

function sameOrigin(candidate: string, origin: string): boolean {
  try {
    return new URL(candidate).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

/**
 * The body sent when the browser rotates an endpoint.
 *
 * Browsers fire `pushsubscriptionchange` when they reissue a subscription.
 * Without handling it, the old endpoint stays in our table, every send to it
 * 410s, and the user quietly stops receiving anything they had opted into.
 */
export function resubscribeBody(subscription: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}): string {
  return JSON.stringify({
    endpoint: subscription.endpoint,
    keys: subscription.keys,
  });
}
