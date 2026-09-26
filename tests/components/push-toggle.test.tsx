import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PushToggle } from "@/app/[locale]/(public)/profile/settings/features/push-toggle";

const errorToast = vi.fn();
vi.mock("@/components/ui/sonner", () => ({
  toast: {
    error: (...args: unknown[]) => errorToast(...args),
    success: vi.fn(),
  },
}));

/**
 * The bug this file exists for, and an honest account of what it proves.
 *
 * Opening /profile/settings produced a column of identical
 * "That did not go through. Nothing was changed." toasts, one after another,
 * for as long as the page stayed open. Nobody had pressed anything. That
 * message is `auth.pushFailed`, which only this component raises, and its only
 * automatic caller is the silent re-subscribe effect below.
 *
 * **The repetition does not reproduce in jsdom.** Measured, in the exact
 * pre-fix configuration — `busy` in the effect's dependencies and no latch —
 * the attempt count after 800 ms was 1, the same as after the fix. Whatever
 * re-fires the effect in a real browser (service-worker readiness, a real
 * `pushManager.subscribe()` round trip, React's scheduling across those gaps)
 * does not happen here. So the counting tests below assert the CONTRACT —
 * at most one automatic attempt — and must not be read as a reproduction of
 * the loop. They would not have caught it.
 *
 * What the suite does guard, and what actually fixes the reported symptom, is
 * the silence: however many times the effect fires, an attempt the reader did
 * not ask for no longer speaks. Breaking that fails these tests; the mutation
 * run is in the pull request.
 */

const VAPID = "BG8yTZes4g1RimvHLRYVAJwFQ3MfzAZmwDdRuMLcHwobhHQSOVHum2QA";

const labels = {
  description: "Get notified on this device.",
  enable: "Turn on",
  enabling: "Asking…",
  enabled: "Notifications are on for this device.",
  disable: "Turn off",
  unsupported: "This browser cannot receive notifications.",
  denied: "Notifications are blocked for this site.",
  iosInstall: "Add Chemlab to your Home Screen.",
  failed: "That did not go through. Nothing was changed.",
};

let subscribeCalls = 0;
let postCalls = 0;

/**
 * A browser that granted permission and has no subscription — the
 * `granted-unsubscribed` state — in which `pushManager.subscribe()` always
 * fails. That combination is the whole reproduction.
 */
function stubBrowser({ subscribeSucceeds = false } = {}) {
  subscribeCalls = 0;
  postCalls = 0;

  const pushManager = {
    getSubscription: vi.fn(async () => null),
    subscribe: vi.fn(async () => {
      subscribeCalls++;
      if (!subscribeSucceeds) throw new Error("push service unreachable");
      return {
        endpoint: "https://push.example.invalid/x",
        toJSON: () => ({ endpoint: "https://push.example.invalid/x" }),
      };
    }),
  };

  vi.stubGlobal("navigator", {
    serviceWorker: { ready: Promise.resolve({ pushManager }) },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    platform: "Linux x86_64",
    maxTouchPoints: 0,
  });

  vi.stubGlobal("Notification", { permission: "granted" });
  vi.stubGlobal("PushManager", class {});
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never;

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      postCalls++;
      return new Response("", { status: 500 });
    }),
  );
}

beforeEach(() => {
  errorToast.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the automatic re-subscribe contract", () => {
  it("attempts the silent re-subscribe once", async () => {
    stubBrowser();
    render(<PushToggle vapidPublicKey={VAPID} labels={labels} />);

    // Wait for the automatic attempt to have happened and settled.
    await waitFor(() => expect(subscribeCalls).toBe(1));

    // Then give it every chance to run again. This is the contract, not a
    // reproduction: see the note at the top of the file.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(subscribeCalls).toBe(1);
  });

  it("does not toast at the reader for a failure they did not ask for", async () => {
    stubBrowser();
    render(<PushToggle vapidPublicKey={VAPID} labels={labels} />);

    await waitFor(() => expect(subscribeCalls).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The silent path is silent. The reader opened a settings page; they did
    // not press anything, so an error toast blames them for nothing.
    expect(errorToast).not.toHaveBeenCalled();
  });

  it("attempts once under StrictMode, which double-invokes effects", async () => {
    // `pnpm dev` runs StrictMode, so this is the development experience, not a
    // hypothetical: without the ref latch the effect fires on both invocations
    // and the reader gets two attempts before anything has gone wrong. The ref
    // survives the simulated remount, which is exactly why it is a ref.
    stubBrowser();
    render(
      <StrictMode>
        <PushToggle vapidPublicKey={VAPID} labels={labels} />
      </StrictMode>,
    );

    await waitFor(() => expect(subscribeCalls).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(subscribeCalls).toBe(1);
  });

  it("does not hammer the subscriptions endpoint", async () => {
    stubBrowser();
    render(<PushToggle vapidPublicKey={VAPID} labels={labels} />);

    await waitFor(() => expect(subscribeCalls).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 50));

    // `pushManager.subscribe()` fails before any POST here, so the count is
    // zero — the assertion is that it never climbs, whatever it starts at.
    expect(postCalls).toBeLessThanOrEqual(1);
  });
});

describe("after a failed silent re-subscribe", () => {
  it("offers a button rather than leaving a card with no control", async () => {
    stubBrowser();
    render(<PushToggle vapidPublicKey={VAPID} labels={labels} />);

    // `granted-unsubscribed` matched no render branch at all, so the card was
    // a heading and a sentence. With the toast suppressed as well, a reader
    // would have no sign anything was wrong and no way to retry.
    expect(
      await screen.findByRole("button", { name: labels.enable }),
    ).toBeVisible();
  });

  it("reports the failure when the reader presses that button", async () => {
    stubBrowser();
    render(<PushToggle vapidPublicKey={VAPID} labels={labels} />);

    const button = await screen.findByRole("button", { name: labels.enable });
    await userEvent.click(button);

    // Pressed means answered: here the toast responds to a question the
    // reader just asked, which is the opposite of the silent case.
    await waitFor(() => expect(errorToast).toHaveBeenCalledTimes(1));
    expect(errorToast.mock.calls[0]![0]).toMatchObject({
      title: labels.failed,
    });
  });
});

describe("the states that were already right", () => {
  it("renders nothing at all without a VAPID key", () => {
    stubBrowser();
    const { container } = render(
      <PushToggle vapidPublicKey={null} labels={labels} />,
    );
    // A control that cannot work should be absent, not disabled.
    expect(container).toBeEmptyDOMElement();
  });

  it("says so, with no button, when permission is denied", async () => {
    stubBrowser();
    vi.stubGlobal("Notification", { permission: "denied" });

    render(<PushToggle vapidPublicKey={VAPID} labels={labels} />);

    expect(await screen.findByText(labels.denied)).toBeVisible();
    // The browser will not show its dialog again, so a button that "asks"
    // would do nothing and look broken.
    expect(screen.queryByRole("button")).toBeNull();
    expect(subscribeCalls).toBe(0);
  });
});
