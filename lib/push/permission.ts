/**
 * What state a browser is in with respect to push, and what to offer.
 *
 * Pure: it takes a description of the environment rather than reading
 * `navigator`, so every branch — including the iOS one, which cannot be
 * reproduced in any test browser we run — is testable.
 *
 * The states are distinct because the right thing to SAY differs in each, and
 * getting that wrong is the whole reason permission prompts are hated. A
 * button that cannot work is worse than no button.
 */

export type PushState =
  /** No `PushManager`. Nothing to offer; say so once and stop. */
  | "unsupported"
  /**
   * iOS Safari, in a normal tab. Push is impossible here no matter how correct
   * the code is: Apple delivers Web Push only to a site installed to the Home
   * Screen. Calling `requestPermission()` here throws or resolves to `denied`,
   * and either way burns the one chance to ask.
   */
  | "ios-needs-install"
  /** Asked before and refused. The browser will not show the dialog again. */
  | "denied"
  /** Allowed, and a subscription exists. Nothing to do. */
  | "subscribed"
  /** Allowed, but no subscription — permission was granted then revoked in
   * our own settings, or the endpoint was dropped. Re-subscribe silently. */
  | "granted-unsubscribed"
  /** Never asked. The only state in which a prompt is appropriate. */
  | "askable";

export interface PushEnvironment {
  hasPushManager: boolean;
  hasNotification: boolean;
  permission: "default" | "granted" | "denied";
  hasSubscription: boolean;
  isIos: boolean;
  /** True when running as an installed app rather than in a browser tab. */
  isStandalone: boolean;
}

export function pushState(environment: PushEnvironment): PushState {
  // Checked BEFORE support: an iOS tab reports no PushManager, and saying
  // "your browser does not support notifications" to somebody whose browser
  // supports them perfectly well once installed is both wrong and unhelpful.
  if (environment.isIos && !environment.isStandalone) {
    return "ios-needs-install";
  }

  if (!environment.hasPushManager || !environment.hasNotification) {
    return "unsupported";
  }

  if (environment.permission === "denied") return "denied";

  if (environment.permission === "granted") {
    return environment.hasSubscription ? "subscribed" : "granted-unsubscribed";
  }

  return "askable";
}

/**
 * Whether a prompt may be shown at all.
 *
 * Never on `denied`: the browser will not show its dialog again, so a button
 * that "asks" would do nothing and look broken. Never on iOS-in-a-tab, for the
 * same reason. #17 is explicit that permission is requested on a user gesture,
 * at a moment that explains itself — this function says whether such a moment
 * can exist, not when to create one.
 */
export function canPrompt(state: PushState): boolean {
  return state === "askable";
}

/** Whether the app should quietly re-subscribe without asking anything. */
export function shouldResubscribe(state: PushState): boolean {
  return state === "granted-unsubscribed";
}

/**
 * Reads the real environment. The only impure part, kept to one function so
 * everything above stays testable.
 */
export function readEnvironment(hasSubscription: boolean): PushEnvironment {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const isIos =
    !!nav &&
    (/iPad|iPhone|iPod/.test(nav.userAgent) ||
      // iPadOS 13+ reports itself as a Mac; the touch-point count is what
      // separates an iPad from a desktop Safari.
      (nav.platform === "MacIntel" && nav.maxTouchPoints > 1));

  return {
    hasPushManager: typeof window !== "undefined" && "PushManager" in window,
    hasNotification: typeof window !== "undefined" && "Notification" in window,
    permission:
      typeof Notification === "undefined" ? "default" : Notification.permission,
    hasSubscription,
    isIos,
    isStandalone:
      typeof window !== "undefined" &&
      (window.matchMedia("(display-mode: standalone)").matches ||
        // Safari's own, non-standard flag. The media query above is false in
        // an installed iOS app on some versions, which is exactly the case
        // this branch has to get right.
        (nav as { standalone?: boolean } | undefined)?.standalone === true),
  };
}
