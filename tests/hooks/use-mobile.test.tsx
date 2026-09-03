import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useIsMobile } from "@/hooks/use-mobile";

type Listener = () => void;

/** Minimal matchMedia stub — jsdom does not implement it. */
function stubMatchMedia(width: number) {
  const listeners = new Set<Listener>();

  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });

  const matchMedia = vi.fn((query: string) => ({
    media: query,
    matches: window.innerWidth < 768,
    addEventListener: (_: string, cb: Listener) => listeners.add(cb),
    removeEventListener: (_: string, cb: Listener) => listeners.delete(cb),
    addListener: (cb: Listener) => listeners.add(cb),
    removeListener: (cb: Listener) => listeners.delete(cb),
    dispatchEvent: () => false,
    onchange: null,
  }));

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: matchMedia,
  });

  return {
    matchMedia,
    listeners,
    resizeTo(next: number) {
      (window as { innerWidth: number }).innerWidth = next;
      act(() => listeners.forEach((cb) => cb()));
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useIsMobile", () => {
  it("reports mobile below the 768px breakpoint", () => {
    stubMatchMedia(500);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("reports desktop at and above the breakpoint", () => {
    stubMatchMedia(768);
    expect(renderHook(() => useIsMobile()).result.current).toBe(false);

    stubMatchMedia(1440);
    expect(renderHook(() => useIsMobile()).result.current).toBe(false);
  });

  it("queries the max-width: 767px media query", () => {
    const { matchMedia } = stubMatchMedia(1024);
    renderHook(() => useIsMobile());
    expect(matchMedia).toHaveBeenCalledWith("(max-width: 767px)");
  });

  it("updates when the viewport crosses the breakpoint", () => {
    const media = stubMatchMedia(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    media.resizeTo(400);
    expect(result.current).toBe(true);

    media.resizeTo(1024);
    expect(result.current).toBe(false);
  });

  it("removes its listener on unmount", () => {
    const media = stubMatchMedia(1024);
    const { unmount } = renderHook(() => useIsMobile());
    expect(media.listeners.size).toBe(1);

    unmount();
    expect(media.listeners.size).toBe(0);
  });

  it("always returns a boolean, never undefined", () => {
    stubMatchMedia(1024);
    expect(typeof renderHook(() => useIsMobile()).result.current).toBe(
      "boolean",
    );
  });
});
