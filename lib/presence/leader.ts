import { HEARTBEAT_MS } from "./constants";

/**
 * One heartbeat per user, not per tab.
 *
 * Five open tabs writing every sixty seconds is five times the write load for
 * exactly the same information. A `BroadcastChannel` lets the tabs agree on
 * one leader: the leader announces itself, the others hear it and stay quiet,
 * and if the leader closes the announcements stop and somebody else takes
 * over within one interval.
 *
 * Deliberately not a lock in `localStorage`: a tab that crashes leaves a lock
 * nobody releases, and every implementation then needs a timeout — which is
 * this, with more moving parts. Silence IS the release here.
 *
 * The election logic is separated from the channel so it can be tested
 * without a browser: `LeaderElection` takes a transport, and the transport in
 * a test is two arrays.
 */

export interface LeaderTransport {
  post: (message: LeaderMessage) => void;
  subscribe: (handler: (message: LeaderMessage) => void) => () => void;
}

export interface LeaderMessage {
  kind: "claim";
  /** Random per tab. Ties are broken by comparing these, so two tabs claiming
   * in the same instant still agree — without it they would both stand down,
   * or both proceed. */
  id: string;
  at: number;
}

/**
 * How long a follower waits before deciding the leader has gone.
 *
 * Longer than one interval, so a leader that is merely slow is not deposed
 * mid-beat and two tabs briefly both write.
 */
export const LEADER_TIMEOUT_MS = HEARTBEAT_MS * 2;

export class LeaderElection {
  private lastHeard = 0;
  private lastHeardFrom: string | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly id: string,
    private readonly transport: LeaderTransport,
    private readonly now: () => number = Date.now,
  ) {}

  start(): void {
    this.unsubscribe = this.transport.subscribe((message) => {
      if (message.kind !== "claim" || message.id === this.id) return;
      this.lastHeard = this.now();
      this.lastHeardFrom = message.id;
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /**
   * Whether this tab should send the next beat.
   *
   * Announces first, then decides: a tab that stayed silent and then declared
   * itself leader would let two tabs both conclude they are alone.
   */
  shouldBeat(): boolean {
    this.transport.post({ kind: "claim", id: this.id, at: this.now() });

    // Nobody else has spoken recently: this tab is on its own.
    if (this.now() - this.lastHeard > LEADER_TIMEOUT_MS) return true;

    // Somebody else is here. The lowest id leads — an arbitrary but STABLE
    // rule, so both tabs reach the same answer rather than alternating.
    return this.lastHeardFrom !== null && this.id < this.lastHeardFrom;
  }
}

/** The real transport. Absent in a browser without `BroadcastChannel`, where
 * every tab beats — which is correct, if slightly wasteful, and better than
 * no heartbeat at all. */
export function broadcastTransport(name: string): LeaderTransport | null {
  if (typeof BroadcastChannel === "undefined") return null;

  const channel = new BroadcastChannel(name);
  return {
    post: (message) => channel.postMessage(message),
    subscribe: (handler) => {
      const listener = (event: MessageEvent<LeaderMessage>) =>
        handler(event.data);
      channel.addEventListener("message", listener);
      return () => {
        channel.removeEventListener("message", listener);
        channel.close();
      };
    },
  };
}
