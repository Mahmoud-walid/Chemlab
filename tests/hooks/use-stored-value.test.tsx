import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useStoredValue } from "@/hooks/use-stored-value";
import { removeStoredValue, writeStoredValue } from "@/lib/browser-storage";
import { useHydrated } from "@/hooks/use-hydrated";

describe("useStoredValue", () => {
  it("returns the stored value", () => {
    sessionStorage.setItem("k", "v");
    const { result } = renderHook(() => useStoredValue("session", "k"));
    expect(result.current).toBe("v");
  });

  it("returns null when nothing is stored and no fallback is given", () => {
    expect(renderHook(() => useStoredValue("local", "k")).result.current).toBe(
      null,
    );
  });

  it("returns the fallback when nothing is stored", () => {
    const { result } = renderHook(() =>
      useStoredValue("local", "font", "roboto"),
    );
    expect(result.current).toBe("roboto");
  });

  it("re-renders when the value is written", () => {
    const { result } = renderHook(() =>
      useStoredValue("local", "font", "roboto"),
    );
    expect(result.current).toBe("roboto");

    act(() => writeStoredValue("local", "font", "inter"));
    expect(result.current).toBe("inter");
  });

  it("falls back again when the value is removed", () => {
    writeStoredValue("local", "font", "inter");
    const { result } = renderHook(() =>
      useStoredValue("local", "font", "roboto"),
    );
    expect(result.current).toBe("inter");

    act(() => removeStoredValue("local", "font"));
    expect(result.current).toBe("roboto");
  });

  it("ignores writes to other keys", () => {
    const { result } = renderHook(() => useStoredValue("local", "font", "a"));
    act(() => writeStoredValue("local", "other", "b"));
    expect(result.current).toBe("a");
  });

  it("stops listening after unmount", () => {
    const { unmount } = renderHook(() => useStoredValue("local", "font", "a"));
    unmount();
    expect(() => writeStoredValue("local", "font", "b")).not.toThrow();
  });
});

describe("useHydrated", () => {
  it("is true once mounted on the client", () => {
    expect(renderHook(() => useHydrated()).result.current).toBe(true);
  });
});
