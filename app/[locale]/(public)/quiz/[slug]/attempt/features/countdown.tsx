"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The countdown.
 *
 * Decoration, and labelled as such in the engine: the server stamped
 * `expiresAt` and re-checks it on every write, so this display can be paused
 * in devtools, throttled to once a minute in a background tab, or never fire
 * at all without changing when the attempt actually ends. What it must do is
 * be honest and be usable.
 *
 * **Honest** — derived from the SERVER's clock. The offset between this
 * machine and the server is measured once, at mount, and every tick is
 * computed from it. A candidate whose laptop clock is twenty minutes fast
 * sees the same remaining time as everybody else.
 *
 * **Usable** — the live region announces at 10m, 5m, 1m and 30s, not every
 * second. A per-second `aria-live` region makes a screen reader unusable: it
 * interrupts the question being read out sixty times a minute. The remaining
 * time is always readable on demand from the text itself, which is why coarse
 * announcements lose nothing.
 */
export function Countdown({
  expiresAt,
  serverNow,
  label,
  timeUpLabel,
  onExpire,
}: {
  /** ISO. Null on an untimed quiz. */
  expiresAt: string | null;
  serverNow: string;
  label: string;
  timeUpLabel: string;
  onExpire: () => void;
}) {
  // Measured once, on mount, inside the effect — never during render.
  // `Date.now()` in a render body is impure: React may re-render for reasons
  // that have nothing to do with time, and each one would re-measure an offset
  // that is supposed to be fixed. Re-measuring mid-sitting would also let a
  // clock that drifts move the deadline.
  const offsetRef = useRef(0);
  // Null until the first tick, so nothing is drawn from this machine's clock
  // before the offset exists.
  const [remaining, setRemaining] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const announcedRef = useRef<Set<number>>(new Set());
  const firedRef = useRef(false);

  useEffect(() => {
    if (expiresAt === null) return;

    offsetRef.current = Date.parse(serverNow) - Date.now();

    const tick = () => {
      const left = msLeft(expiresAt, offsetRef.current);
      setRemaining(left);

      // Coarse announcements only — see the note above. Each threshold fires
      // once, tracked by a set rather than by comparing against the previous
      // tick, because a background tab can skip a whole minute in one step.
      for (const threshold of THRESHOLDS) {
        if (left <= threshold.ms && !announcedRef.current.has(threshold.ms)) {
          announcedRef.current.add(threshold.ms);
          setAnnouncement(threshold.label(label));
        }
      }

      if (left <= 0 && !firedRef.current) {
        firedRef.current = true;
        setAnnouncement(timeUpLabel);
        onExpire();
      }
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt, serverNow, label, timeUpLabel, onExpire]);

  if (expiresAt === null || remaining === null) return null;

  const urgent = remaining <= 60_000;

  return (
    <div className="flex items-center gap-2">
      <span
        // `motion-safe` only: a timer that pulses is exactly the kind of
        // animation `prefers-reduced-motion` exists to stop, and an exam is
        // the worst place to ignore it.
        className={
          urgent
            ? "motion-safe:animate-pulse font-mono text-sm font-semibold text-destructive"
            : "font-mono text-sm text-muted-foreground"
        }
      >
        {label} {formatRemaining(remaining)}
      </span>

      {/* Polite, so it waits for the screen reader to finish the sentence it
          is on rather than cutting into a question. */}
      <span aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}

const THRESHOLDS = [
  { ms: 600_000, label: (l: string) => `${l} 10:00` },
  { ms: 300_000, label: (l: string) => `${l} 5:00` },
  { ms: 60_000, label: (l: string) => `${l} 1:00` },
  { ms: 30_000, label: (l: string) => `${l} 0:30` },
] as const;

function msLeft(expiresAt: string, offset: number): number {
  return Math.max(0, Date.parse(expiresAt) - (Date.now() + offset));
}

/** mm:ss, and hh:mm:ss past an hour. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}
