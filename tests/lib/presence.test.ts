import { describe, expect, it } from "vitest";

import {
  AWAY_WINDOW_MS,
  HEARTBEAT_MS,
  HEARTBEAT_JITTER,
  ONLINE_WINDOW_MS,
  WRITE_FLOOR_MS,
} from "@/lib/presence/constants";
import { isVisibleState, nextBeatMs, presenceFrom } from "@/lib/presence/state";
import {
  LEADER_TIMEOUT_MS,
  LeaderElection,
  type LeaderMessage,
  type LeaderTransport,
} from "@/lib/presence/leader";

/**
 * Presence is derived from a timestamp, so the whole feature is these
 * comparisons — and every one of them is a claim about a person that the UI
 * will state as fact.
 */

const now = new Date("2026-03-10T12:00:00.000Z");
const secondsAgo = (n: number) => new Date(now.getTime() - n * 1000);

describe("deriving state", () => {
  it("is online inside the window, which is 2.5 heartbeats", () => {
    // One dropped beat must not flick somebody offline and back.
    expect(ONLINE_WINDOW_MS).toBe(HEARTBEAT_MS * 2.5);
    expect(presenceFrom(secondsAgo(10), now)).toBe("online");
    expect(presenceFrom(secondsAgo(120), now)).toBe("online");
  });

  it("is away between the windows", () => {
    // "Offline" reads as "gone", and somebody who was here four minutes ago
    // has probably not gone.
    expect(presenceFrom(secondsAgo(200), now)).toBe("away");
    expect(presenceFrom(secondsAgo(14 * 60), now)).toBe("away");
  });

  it("is offline past the away window", () => {
    expect(presenceFrom(secondsAgo(16 * 60), now)).toBe("offline");
    expect(presenceFrom(secondsAgo(86_400), now)).toBe("offline");
  });

  it("never reports a boolean that could go stale", () => {
    // A stored `is_online` survives a browser being closed without a clean
    // disconnect — the common case, not the edge one. There is nothing to
    // store here: the state is a function of the clock.
    const seen = secondsAgo(10);
    expect(presenceFrom(seen, now)).toBe("online");
    expect(
      presenceFrom(seen, new Date(now.getTime() + AWAY_WINDOW_MS + 1000)),
    ).toBe("offline");
  });

  it("treats a never-seen user as offline, not unknown", () => {
    // Absent evidence of presence IS evidence of absence here: the row is
    // written on the first heartbeat, so no row means they have never been on.
    expect(presenceFrom(null, now)).toBe("offline");
    expect(presenceFrom(undefined, now)).toBe("offline");
  });

  it("survives clock skew rather than reporting the future as offline", () => {
    // The browser's clock and the database's are not the same clock.
    expect(presenceFrom(new Date(now.getTime() + 5_000), now)).toBe("online");
  });

  it("says `unknown` for a timestamp it cannot read", () => {
    // And `unknown` renders NOTHING. A grey "offline" dot because a query
    // failed is a claim about somebody with no basis.
    expect(presenceFrom("not a date", now)).toBe("unknown");
    expect(isVisibleState("unknown")).toBe(false);
    expect(isVisibleState("offline")).toBe(true);
  });
});

describe("the write floor", () => {
  it("sits below the heartbeat, so an on-time beat is never rejected", () => {
    // If the floor were >= the interval, every second beat would match zero
    // rows and presence would lag by a whole cycle.
    expect(WRITE_FLOOR_MS).toBeLessThan(HEARTBEAT_MS);
    // And far enough below that a jittered early beat still lands.
    expect(WRITE_FLOOR_MS).toBeLessThan(HEARTBEAT_MS * (1 - HEARTBEAT_JITTER));
  });
});

describe("jitter", () => {
  it("is centred on the interval, not added to it", () => {
    // Adding 0..+10% would make the average interval longer than the constant
    // says, and the online window is sized from that constant.
    expect(nextBeatMs(HEARTBEAT_MS, HEARTBEAT_JITTER, () => 0.5)).toBe(
      HEARTBEAT_MS,
    );
    expect(nextBeatMs(HEARTBEAT_MS, HEARTBEAT_JITTER, () => 0)).toBe(54_000);
    expect(nextBeatMs(HEARTBEAT_MS, HEARTBEAT_JITTER, () => 1)).toBe(66_000);
  });

  it("stays inside the online window however it falls", () => {
    for (const roll of [0, 0.25, 0.5, 0.75, 1]) {
      expect(
        nextBeatMs(HEARTBEAT_MS, HEARTBEAT_JITTER, () => roll),
      ).toBeLessThan(ONLINE_WINDOW_MS);
    }
  });
});

describe("one heartbeat per user, not per tab", () => {
  /** Two tabs on one channel, with a clock a test controls. */
  function twoTabs(clock: { value: number }) {
    const handlers: ((message: LeaderMessage) => void)[] = [];
    const transport = (): LeaderTransport => ({
      post: (message) => handlers.forEach((handler) => handler(message)),
      subscribe: (handler) => {
        handlers.push(handler);
        return () => handlers.splice(handlers.indexOf(handler), 1);
      },
    });

    const a = new LeaderElection("aaa", transport(), () => clock.value);
    const b = new LeaderElection("bbb", transport(), () => clock.value);
    a.start();
    b.start();
    return { a, b };
  }

  it("elects exactly one leader when both are open", () => {
    const clock = { value: 1_000_000 };
    const { a, b } = twoTabs(clock);

    // First round: neither has heard the other yet, so both may beat. The
    // round that matters is the second, once they know about each other.
    a.shouldBeat();
    b.shouldBeat();

    const beats = [a.shouldBeat(), b.shouldBeat()].filter(Boolean);
    expect(beats).toHaveLength(1);
  });

  it("is stable — the same tab keeps leading", () => {
    // Alternating leaders would be two writes per interval, which is the
    // thing being avoided.
    const clock = { value: 1_000_000 };
    const { a, b } = twoTabs(clock);
    a.shouldBeat();
    b.shouldBeat();

    for (let round = 0; round < 5; round++) {
      clock.value += 1_000;
      expect(a.shouldBeat()).toBe(true);
      expect(b.shouldBeat()).toBe(false);
    }
  });

  it("hands over when the leader goes quiet", () => {
    // A closed tab stops announcing. Silence is the release — no lock to
    // leave behind, and nothing to clean up after a crash.
    const clock = { value: 1_000_000 };
    const handlers: ((message: LeaderMessage) => void)[] = [];
    const follower = new LeaderElection(
      "zzz",
      {
        post: (message) => handlers.forEach((handler) => handler(message)),
        subscribe: (handler) => {
          handlers.push(handler);
          return () => {};
        },
      },
      () => clock.value,
    );
    follower.start();

    // A leader with a lower id speaks.
    handlers.forEach((handler) =>
      handler({ kind: "claim", id: "aaa", at: clock.value }),
    );
    expect(follower.shouldBeat()).toBe(false);

    // …and then stops.
    clock.value += LEADER_TIMEOUT_MS + 1;
    expect(follower.shouldBeat()).toBe(true);
  });

  it("lets a lone tab beat", () => {
    const clock = { value: 1_000_000 };
    const alone = new LeaderElection(
      "solo",
      { post: () => {}, subscribe: () => () => {} },
      () => clock.value,
    );
    alone.start();
    expect(alone.shouldBeat()).toBe(true);
  });
});
