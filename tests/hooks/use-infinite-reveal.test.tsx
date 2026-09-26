import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useInfiniteReveal } from "@/hooks/use-infinite-reveal";

const items = (count: number) =>
  Array.from({ length: count }, (_, index) => index);

interface Observed {
  callback: IntersectionObserverCallback;
  elements: Element[];
  disconnected: boolean;
}

/**
 * jsdom has no `IntersectionObserver` at all, which is itself the reason the
 * sentinel in both catalogues is a real button — see the hook. This stub is
 * here to prove the observer path, not to pretend jsdom scrolls.
 */
function stubObserver(): Observed[] {
  const created: Observed[] = [];
  class Stub {
    private record: Observed;
    constructor(callback: IntersectionObserverCallback) {
      this.record = { callback, elements: [], disconnected: false };
      created.push(this.record);
    }
    observe(element: Element) {
      this.record.elements.push(element);
    }
    unobserve() {}
    disconnect() {
      this.record.disconnected = true;
    }
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal("IntersectionObserver", Stub);
  return created;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the first page", () => {
  it("shows one page and reports that there is more", () => {
    const { result } = renderHook(() =>
      useInfiniteReveal({ items: items(20), pageSize: 6, resetKey: "a" }),
    );
    expect(result.current.visible).toHaveLength(6);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.remaining).toBe(14);
  });

  it("reports no more when the list fits in one page", () => {
    const { result } = renderHook(() =>
      useInfiniteReveal({ items: items(4), pageSize: 6, resetKey: "a" }),
    );
    expect(result.current.visible).toHaveLength(4);
    // The sentinel renders only on `hasMore`, so this is what keeps a "show 0
    // more" button off the end of a short catalogue.
    expect(result.current.hasMore).toBe(false);
    expect(result.current.remaining).toBe(0);
  });

  it("handles an empty list without going negative", () => {
    const { result } = renderHook(() =>
      useInfiniteReveal({ items: [], pageSize: 6, resetKey: "a" }),
    );
    expect(result.current.visible).toEqual([]);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.remaining).toBe(0);
  });
});

describe("revealing", () => {
  it("adds a page at a time", () => {
    const { result } = renderHook(() =>
      useInfiniteReveal({ items: items(20), pageSize: 6, resetKey: "a" }),
    );
    act(() => result.current.revealMore());
    expect(result.current.visible).toHaveLength(12);
    act(() => result.current.revealMore());
    expect(result.current.visible).toHaveLength(18);
    act(() => result.current.revealMore());
    // Never past the end, and never a short page at the end either.
    expect(result.current.visible).toHaveLength(20);
    expect(result.current.hasMore).toBe(false);
  });
});

describe("resetting", () => {
  it("starts over at one page when the key changes", () => {
    // The bug this is the whole point of: somebody scrolls to lesson 18, types
    // a search, and is handed eighteen results.
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) =>
        useInfiniteReveal({ items: items(20), pageSize: 6, resetKey: key }),
      { initialProps: { key: "all|" } },
    );

    act(() => result.current.revealMore());
    act(() => result.current.revealMore());
    expect(result.current.visible).toHaveLength(18);

    rerender({ key: "all|acid" });
    expect(result.current.visible).toHaveLength(6);
  });

  it("resets on the FIRST render of the new key, with no long list in between", () => {
    // The reason the key is compared during render rather than corrected from
    // an effect: an effect runs after the paint, so the reader sees the long
    // list flash. `renderHook` gives us that intermediate render to assert on.
    const seen: number[] = [];
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => {
        const reveal = useInfiniteReveal({
          items: items(20),
          pageSize: 6,
          resetKey: key,
        });
        seen.push(reveal.visible.length);
        return reveal;
      },
      { initialProps: { key: "a" } },
    );

    act(() => result.current.revealMore());
    rerender({ key: "b" });

    expect(seen.at(-1)).toBe(6);
    // Nothing longer than a page was ever produced under the new key.
    expect(seen.filter((length) => length > 12)).toEqual([]);
  });

  it("keeps revealing after a reset rather than jumping back to the old count", () => {
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) =>
        useInfiniteReveal({ items: items(20), pageSize: 6, resetKey: key }),
      { initialProps: { key: "a" } },
    );
    act(() => result.current.revealMore());
    rerender({ key: "b" });
    act(() => result.current.revealMore());
    expect(result.current.visible).toHaveLength(12);
  });

  it("does not reset on an unrelated re-render", () => {
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) =>
        useInfiniteReveal({ items: items(20), pageSize: 6, resetKey: key }),
      { initialProps: { key: "a" } },
    );
    act(() => result.current.revealMore());
    rerender({ key: "a" });
    expect(result.current.visible).toHaveLength(12);
  });
});

describe("the observer", () => {
  it("watches the sentinel and reveals when it comes into view", () => {
    const created = stubObserver();
    const { result } = renderHook(() =>
      useInfiniteReveal({ items: items(20), pageSize: 6, resetKey: "a" }),
    );

    const node = document.createElement("button");
    act(() => result.current.sentinelRef(node));

    expect(created).toHaveLength(1);
    expect(created[0]!.elements).toEqual([node]);

    act(() =>
      created[0]!.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
    expect(result.current.visible).toHaveLength(12);
  });

  it("ignores an entry that is not intersecting", () => {
    const created = stubObserver();
    const { result } = renderHook(() =>
      useInfiniteReveal({ items: items(20), pageSize: 6, resetKey: "a" }),
    );
    act(() => result.current.sentinelRef(document.createElement("button")));
    act(() =>
      created[0]!.callback(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
    expect(result.current.visible).toHaveLength(6);
  });

  it("stops observing once everything is revealed", () => {
    const created = stubObserver();
    const { result } = renderHook(() =>
      useInfiniteReveal({ items: items(8), pageSize: 6, resetKey: "a" }),
    );
    act(() => result.current.sentinelRef(document.createElement("button")));
    act(() => result.current.revealMore());

    // An observer left watching a sentinel that is no longer rendered holds a
    // detached node and a closure over a stale count.
    expect(created[0]!.disconnected).toBe(true);
    // And no replacement was made. Asserting only the disconnect is not
    // enough: `hasMore` is in the effect's dependencies, so a version missing
    // the `hasMore` guard still tears the old observer down — and then builds
    // another one, on an element the page has stopped rendering. Measured: the
    // disconnect assertion alone passes against that mutant.
    expect(created).toHaveLength(1);
  });

  it("does not throw where IntersectionObserver does not exist", () => {
    // jsdom, and every browser old enough to matter. `revealMore` via the
    // button is the only path there, and it still has to work.
    const { result } = renderHook(() =>
      useInfiniteReveal({ items: items(20), pageSize: 6, resetKey: "a" }),
    );
    act(() => result.current.sentinelRef(document.createElement("button")));
    act(() => result.current.revealMore());
    expect(result.current.visible).toHaveLength(12);
  });
});
