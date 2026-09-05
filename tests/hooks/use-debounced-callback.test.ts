import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDebouncedCallback } from "@/hooks/use-debounced-callback";

/**
 * The debounce behind the admin search box.
 *
 * Fake timers rather than real waits: the thing being tested is WHEN the call
 * happens, and a test that sleeps for it is slow and still tells you less.
 */
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useDebouncedCallback", () => {
  it("calls once, after the pause", () => {
    const spy = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(spy, 300));

    act(() => {
      result.current.call("a");
      result.current.call("ac");
      result.current.call("aci");
    });
    expect(spy).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(300));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("passes the latest arguments, not the first", () => {
    // The timer is reset, not queued. Otherwise "acid" lands after "acids"
    // and the list shows the results for a prefix nobody is looking at.
    const spy = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(spy, 300));

    act(() => {
      result.current.call("acid");
      vi.advanceTimersByTime(200);
      result.current.call("acids");
      vi.advanceTimersByTime(300);
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("acids");
  });

  it("runs the pending call immediately on flush", () => {
    // Somebody who types and presses Enter has said they are done. Making
    // them wait out a timer they cannot see is worse than no debounce.
    const spy = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(spy, 300));

    act(() => {
      result.current.call("acids");
      result.current.flush();
    });

    expect(spy).toHaveBeenCalledWith("acids");
    act(() => vi.advanceTimersByTime(300));
    // And does not fire twice.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does nothing when flushed with nothing pending", () => {
    const spy = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(spy, 300));
    act(() => result.current.flush());
    expect(spy).not.toHaveBeenCalled();
  });

  it("forgets the pending call on cancel", () => {
    const spy = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(spy, 300));

    act(() => {
      result.current.call("acids");
      result.current.cancel();
      vi.advanceTimersByTime(300);
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it("drops the pending call on unmount", () => {
    // A navigation fired from a component that is gone updates a URL the
    // reader has already left.
    const spy = vi.fn();
    const { result, unmount } = renderHook(() =>
      useDebouncedCallback(spy, 300),
    );

    act(() => result.current.call("acids"));
    unmount();
    act(() => vi.advanceTimersByTime(300));

    expect(spy).not.toHaveBeenCalled();
  });

  it("calls the newest callback, not the one captured on first render", () => {
    // The returned function is stable so it does not reset its own timer from
    // an effect. The cost of that is a stale closure, which the ref prevents.
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ callback }) => useDebouncedCallback(callback, 300),
      { initialProps: { callback: first } },
    );

    act(() => result.current.call("acids"));
    rerender({ callback: second });
    act(() => vi.advanceTimersByTime(300));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("acids");
  });

  it("keeps the same identity across renders", () => {
    // A debounced function that changes identity every render resets its own
    // timer from an effect, which is a debounce that never fires.
    const { result, rerender } = renderHook(() =>
      useDebouncedCallback(() => {}, 300),
    );
    const before = result.current;
    rerender();
    expect(result.current).toBe(before);
    expect(result.current.call).toBe(before.call);
  });
});
