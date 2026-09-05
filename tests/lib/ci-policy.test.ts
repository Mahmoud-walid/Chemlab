import { describe, expect, it } from "vitest";

import {
  DEFAULT_CI_PREFERENCES,
  decideNotify,
  watchesBranch,
  type CiPreferences,
} from "@/lib/ci/policy";

/**
 * The logic whose bugs are invisible: a policy that quietly notifies nobody
 * looks exactly like a repository whose build never breaks.
 */

const opted = (overrides: Partial<CiPreferences> = {}): CiPreferences => ({
  ...DEFAULT_CI_PREFERENCES,
  enabled: true,
  ...overrides,
});

describe("opting in", () => {
  it("sends nothing to somebody who never asked", () => {
    // The default is off, and it is a per-account choice rather than a role
    // check: having admin rights must not conscript anybody into build noise.
    expect(DEFAULT_CI_PREFERENCES.enabled).toBe(false);
    expect(
      decideNotify("failure", "success", "main", DEFAULT_CI_PREFERENCES),
    ).toEqual({ notify: false, reason: "not-opted-in", recovery: false });
  });
});

describe("the branch filter", () => {
  it("watches main alone by default", () => {
    // A red `main` is the emergency. Everything else is opt-in on top.
    expect(DEFAULT_CI_PREFERENCES.branches).toEqual(["main"]);
    expect(decideNotify("failure", null, "feat/xyz", opted()).reason).toBe(
      "branch-not-watched",
    );
    expect(decideNotify("failure", null, "main", opted()).notify).toBe(true);
  });

  it("matches a prefix pattern, but not the prefix itself", () => {
    // Somebody watching `feat/*` asked for the branches under it, not for a
    // branch that happens to be called `feat`.
    expect(watchesBranch(["feat/*"], "feat/notifications")).toBe(true);
    expect(watchesBranch(["feat/*"], "feat")).toBe(false);
    expect(watchesBranch(["feat/*"], "fix/typo")).toBe(false);
  });

  it("takes a star as everything", () => {
    expect(watchesBranch(["*"], "anything/at/all")).toBe(true);
  });

  it("takes an empty list as nothing", () => {
    // Not as "everything": a list somebody emptied means they want silence,
    // and reading it the other way is how a feature becomes a spam source.
    expect(watchesBranch([], "main")).toBe(false);
  });
});

describe("failures", () => {
  it("always alerts, including twice in a row", () => {
    // Each failure is a different commit with a different cause. The second is
    // not less broken than the first.
    expect(decideNotify("failure", "failure", "main", opted()).notify).toBe(
      true,
    );
    expect(decideNotify("failure", "success", "main", opted()).notify).toBe(
      true,
    );
    expect(decideNotify("failure", null, "main", opted()).notify).toBe(true);
  });

  it("can be muted, and says so", () => {
    expect(
      decideNotify("failure", null, "main", opted({ notifyOnFailure: false })),
    ).toEqual({ notify: false, reason: "failure-muted", recovery: false });
  });
});

describe("successes", () => {
  it("says nothing when the build was already green", () => {
    // Dozens of "✅ it worked" a day is how a channel becomes one you have
    // learned to ignore — and then you are ignoring the failures too.
    expect(decideNotify("success", "success", "main", opted())).toEqual({
      notify: false,
      reason: "success-not-a-recovery",
      recovery: false,
    });
  });

  it("announces the first green after a red", () => {
    // The one success worth hearing about: `main` is fixed.
    expect(decideNotify("success", "failure", "main", opted())).toEqual({
      notify: true,
      reason: null,
      recovery: true,
    });
    expect(decideNotify("success", "cancelled", "main", opted()).recovery).toBe(
      true,
    );
  });

  it("treats a first-ever run as nothing to recover from", () => {
    // Otherwise every repository announces itself once, for no reason.
    expect(decideNotify("success", null, "main", opted()).notify).toBe(false);
  });

  it("honours always and never", () => {
    expect(
      decideNotify(
        "success",
        "success",
        "main",
        opted({ successPolicy: "always" }),
      ).notify,
    ).toBe(true);
    expect(
      decideNotify(
        "success",
        "failure",
        "main",
        opted({ successPolicy: "never" }),
      ),
    ).toEqual({ notify: false, reason: "success-muted", recovery: false });
  });

  it("still calls an always-policy green after a red a recovery", () => {
    // The message differs — "back to green" rather than "passed" — so the flag
    // has to survive the policy that would have sent it anyway.
    expect(
      decideNotify(
        "success",
        "failure",
        "main",
        opted({ successPolicy: "always" }),
      ).recovery,
    ).toBe(true);
  });
});

describe("cancellations", () => {
  it("are off by default", () => {
    // Usually a human pressing cancel or a superseded PR run, not a defect.
    expect(decideNotify("cancelled", "success", "main", opted())).toEqual({
      notify: false,
      reason: "cancellation-muted",
      recovery: false,
    });
  });

  it("can be turned on", () => {
    expect(
      decideNotify(
        "cancelled",
        "success",
        "main",
        opted({ notifyOnCancelled: true }),
      ).notify,
    ).toBe(true);
  });
});
