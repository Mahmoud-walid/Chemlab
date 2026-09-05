import { describe, expect, it } from "vitest";

import {
  canPrompt,
  pushState,
  shouldResubscribe,
  type PushEnvironment,
} from "@/lib/push/permission";

/**
 * Which state a browser is in, and what may be offered in it.
 *
 * These branches are the reason permission prompts are hated when they go
 * wrong: a button that cannot work is worse than no button, and the one
 * chance to ask is spent by asking at the wrong moment.
 */

const BASE: PushEnvironment = {
  hasPushManager: true,
  hasNotification: true,
  permission: "default",
  hasSubscription: false,
  isIos: false,
  isStandalone: false,
};

const env = (overrides: Partial<PushEnvironment>): PushEnvironment => ({
  ...BASE,
  ...overrides,
});

describe("pushState", () => {
  it("is askable on a fresh supported browser", () => {
    expect(pushState(BASE)).toBe("askable");
  });

  it("is unsupported where there is no PushManager", () => {
    expect(pushState(env({ hasPushManager: false }))).toBe("unsupported");
  });

  it("tells an iOS tab to install, NOT that its browser is unsupported", () => {
    // An iOS tab reports no PushManager. Saying "your browser does not support
    // notifications" to somebody whose browser supports them perfectly well
    // once installed is both wrong and unhelpful — and it is what a naive
    // support check says.
    const ios = env({
      isIos: true,
      isStandalone: false,
      hasPushManager: false,
    });
    expect(pushState(ios)).toBe("ios-needs-install");
  });

  it("treats an installed iOS app as an ordinary browser", () => {
    expect(pushState(env({ isIos: true, isStandalone: true }))).toBe("askable");
  });

  it("reports a refusal as denied", () => {
    expect(pushState(env({ permission: "denied" }))).toBe("denied");
  });

  it("distinguishes granted-with-subscription from granted-without", () => {
    expect(
      pushState(env({ permission: "granted", hasSubscription: true })),
    ).toBe("subscribed");
    expect(
      pushState(env({ permission: "granted", hasSubscription: false })),
    ).toBe("granted-unsubscribed");
  });
});

describe("canPrompt", () => {
  it("allows a prompt only when the browser has never been asked", () => {
    expect(canPrompt("askable")).toBe(true);
  });

  it.each([
    "denied",
    "ios-needs-install",
    "unsupported",
    "subscribed",
  ] as const)("refuses to prompt in the %s state", (state) => {
    // On `denied` the browser will not show its dialog again, so a button
    // that "asks" does nothing and looks broken. On iOS-in-a-tab the call
    // throws or resolves denied, burning the one chance to ask.
    expect(canPrompt(state)).toBe(false);
  });
});

describe("shouldResubscribe", () => {
  it("re-subscribes silently when permission is already granted", () => {
    // No prompt: the user already said yes, and asking again would be asking
    // them to re-consent to something they never withdrew.
    expect(shouldResubscribe("granted-unsubscribed")).toBe(true);
  });

  it("does not re-subscribe in any other state", () => {
    for (const state of [
      "askable",
      "denied",
      "subscribed",
      "unsupported",
      "ios-needs-install",
    ] as const) {
      expect(shouldResubscribe(state)).toBe(false);
    }
  });
});
