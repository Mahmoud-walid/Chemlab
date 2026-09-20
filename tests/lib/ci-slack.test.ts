import { afterEach, describe, expect, it, vi } from "vitest";

import { postToSlack } from "@/lib/ci/slack";
import type { SlackMessage } from "@/lib/ci/render";

/**
 * `postToSlack` is the only part of the CI-alert path that talks to a third
 * party, and its entire contract is about what happens when that goes wrong.
 *
 * The rendering is covered next door in `ci-render.test.ts`; what is proved
 * here is the promise the caller depends on and the type cannot express: that
 * this function reports failure as a VALUE and never throws. `/api/ci/notify`
 * awaits it while the workflow waits on the response, so an exception escaping
 * here does not lose a Slack message — it fails the CI step that was only
 * asking to be announced, and the build goes red for a reason that has nothing
 * to do with the build.
 *
 * Every case mocks `fetch`. A test that posted to a real webhook would be a
 * test that fails when somebody else's network does.
 */

const MESSAGE: SlackMessage = {
  text: "verify failed on main",
  blocks: [{ type: "section" }],
};

const WEBHOOK = "https://hooks.slack.invalid/services/T000/B000/xxxx";

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Replaces `fetch` and hands back the spy, so calls can be asserted on.
 *
 * The parameters are declared even though the implementations ignore them:
 * without them the spy is typed as taking none, and `mock.calls[0]` becomes
 * `[]` — which makes the assertions below a cast rather than a check.
 */
function stubFetch(implementation: () => Promise<Response>) {
  const spy = vi.fn((_url: string, _init: RequestInit) => implementation());
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("postToSlack", () => {
  it("reports an unconfigured webhook as skipped, without reaching the network", async () => {
    const fetchSpy = stubFetch(() =>
      Promise.reject(new Error("must not be called")),
    );

    await expect(postToSlack(undefined, MESSAGE)).resolves.toBe("skipped");

    // The distinction that matters: "skipped" is not "failed". The Web Push
    // half ships without a webhook, so an absent one is a configuration state
    // the operator chose, not an incident. Asserting the call count as well as
    // the value stops a future refactor from "helpfully" posting to an empty
    // string and reporting failure for something nobody asked for.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("treats an empty webhook the same as an absent one", async () => {
    const fetchSpy = stubFetch(() =>
      Promise.reject(new Error("must not be called")),
    );

    // An unset environment variable often arrives as "" rather than undefined.
    await expect(postToSlack("", MESSAGE)).resolves.toBe("skipped");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts the message as JSON and reports a 2xx as sent", async () => {
    const fetchSpy = stubFetch(() =>
      Promise.resolve(new Response("ok", { status: 200 })),
    );

    await expect(postToSlack(WEBHOOK, MESSAGE)).resolves.toBe("sent");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(WEBHOOK);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "content-type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual(MESSAGE);
  });

  it("gives up on a hung webhook rather than holding the workflow open", async () => {
    const fetchSpy = stubFetch(() =>
      Promise.resolve(new Response("ok", { status: 200 })),
    );

    await postToSlack(WEBHOOK, MESSAGE);

    // Slack answers in milliseconds when it answers at all. Without a deadline
    // the workflow step waits on ITS own timeout instead, which is minutes of
    // a CI runner spent on an announcement.
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports a rejected webhook as failed", async () => {
    // Slack answers 403 with `invalid_token` for a revoked webhook, which is
    // the likeliest real failure: the URL keeps working until it is rotated.
    stubFetch(() =>
      Promise.resolve(new Response("invalid_token", { status: 403 })),
    );

    await expect(postToSlack(WEBHOOK, MESSAGE)).resolves.toBe("failed");
  });

  it("reports a 500 from Slack as failed", async () => {
    stubFetch(() =>
      Promise.resolve(new Response("server error", { status: 500 })),
    );

    await expect(postToSlack(WEBHOOK, MESSAGE)).resolves.toBe("failed");
  });

  it("swallows a network error and reports it as a value", async () => {
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));

    // The load-bearing assertion in this file. `resolves` rather than a
    // try/catch on purpose: if this ever throws, the test fails as an
    // unhandled rejection rather than passing on a technicality.
    await expect(postToSlack(WEBHOOK, MESSAGE)).resolves.toBe("failed");
  });

  it("swallows an abort and reports it as a value", async () => {
    // What the 5-second deadline above actually produces when it fires.
    stubFetch(() =>
      Promise.reject(
        new DOMException("The operation was aborted.", "TimeoutError"),
      ),
    );

    await expect(postToSlack(WEBHOOK, MESSAGE)).resolves.toBe("failed");
  });
});
