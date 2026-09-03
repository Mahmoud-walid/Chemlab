import { describe, expect, it, vi } from "vitest";
import {
  readStoredValue,
  removeStoredValue,
  subscribeToStorage,
  writeStoredValue,
} from "@/lib/browser-storage";

describe("browser-storage", () => {
  it("round-trips a value through sessionStorage", () => {
    writeStoredValue("session", "k", "v");
    expect(readStoredValue("session", "k")).toBe("v");
    expect(sessionStorage.getItem("k")).toBe("v");
  });

  it("round-trips a value through localStorage", () => {
    writeStoredValue("local", "k", "v");
    expect(readStoredValue("local", "k")).toBe("v");
    expect(localStorage.getItem("k")).toBe("v");
  });

  it("keeps local and session storage separate", () => {
    writeStoredValue("local", "k", "local");
    writeStoredValue("session", "k", "session");
    expect(readStoredValue("local", "k")).toBe("local");
    expect(readStoredValue("session", "k")).toBe("session");
  });

  it("returns null for a missing key", () => {
    expect(readStoredValue("local", "nope")).toBeNull();
  });

  it("removes a value", () => {
    writeStoredValue("session", "k", "v");
    removeStoredValue("session", "k");
    expect(readStoredValue("session", "k")).toBeNull();
  });

  it("returns null instead of throwing when storage is unavailable", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    expect(readStoredValue("local", "k")).toBeNull();
    spy.mockRestore();
  });

  it("does not throw when a write is rejected", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });
    expect(() => writeStoredValue("local", "k", "v")).not.toThrow();
    spy.mockRestore();
  });

  it("notifies subscribers on write and remove", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToStorage(listener);

    writeStoredValue("session", "k", "v");
    expect(listener).toHaveBeenCalledTimes(1);

    removeStoredValue("session", "k");
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    writeStoredValue("session", "k", "v2");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("notifies subscribers of cross-tab storage events", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToStorage(listener);

    window.dispatchEvent(new StorageEvent("storage", { key: "k" }));
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.dispatchEvent(new StorageEvent("storage", { key: "k" }));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
