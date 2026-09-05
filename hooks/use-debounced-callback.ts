"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

/**
 * Calls a function once the caller stops calling it.
 *
 * The admin search box pushes a URL and a server round trip on every change.
 * At 119 elements on localhost that is invisible; on the activity log over a
 * phone connection it is one request per keystroke, each one racing the last,
 * and the list flickers through the prefixes of what somebody typed.
 *
 * Three details that are the difference between a debounce and a bug:
 *
 * - **The latest arguments always win.** The timer is reset, not queued, so
 *   "acid" never lands after "acids".
 * - **`flush` exists.** Somebody who types and presses Enter has said they
 *   are done; making them wait out a timer they cannot see is worse than no
 *   debounce at all.
 * - **The pending call is dropped on unmount.** A navigation fired from a
 *   component that is gone updates a URL the reader has already left.
 *
 * The callback is held in a ref so the returned function is stable: a
 * debounced function that changes identity every render resets its own timer
 * from an effect, which is a debounce that never fires.
 */
export interface Debounced<TArgs extends unknown[]> {
  /** Schedule a call, replacing any already pending. */
  call: (...args: TArgs) => void;
  /** Run any pending call now. */
  flush: () => void;
  /** Forget any pending call. */
  cancel: () => void;
}

export function useDebouncedCallback<TArgs extends unknown[]>(
  callback: (...args: TArgs) => void,
  delayMs: number,
): Debounced<TArgs> {
  const latest = useRef(callback);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingArgs = useRef<TArgs | null>(null);

  useEffect(() => {
    latest.current = callback;
  }, [callback]);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pendingArgs.current = null;
  }, []);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const args = pendingArgs.current;
    pendingArgs.current = null;
    if (args) latest.current(...args);
  }, []);

  // Unmount drops the pending call rather than firing it. This is the opposite
  // of the comment collapse window, which flushes — and deliberately so: there
  // the pending value is somebody's decision, here it is a search box's
  // intermediate state.
  useEffect(() => cancel, [cancel]);

  const run = useCallback(
    (...args: TArgs) => {
      pendingArgs.current = args;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        const next = pendingArgs.current;
        pendingArgs.current = null;
        if (next) latest.current(...next);
      }, delayMs);
    },
    [delayMs],
  );

  // An object rather than a callable with properties hung off it. The
  // properties would be a mutation of a value React owns, which the compiler
  // rejects — and rightly: a function whose identity is stable but whose
  // properties are rewritten every render is a value that memoisation cannot
  // reason about.
  return useMemo(() => ({ call: run, flush, cancel }), [run, flush, cancel]);
}
