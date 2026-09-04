"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  readStoredValue,
  subscribeToStorage,
  type StorageKind,
} from "@/lib/browser-storage";

/**
 * Reads a string from local/session storage without a setState-in-effect
 * round trip. Renders `fallback` on the server and during hydration, then the
 * stored value; re-renders whenever the value is written through
 * `writeStoredValue` / `removeStoredValue`, or changed in another tab.
 */
export function useStoredValue(
  kind: StorageKind,
  key: string,
  fallback: string | null = null,
): string | null {
  const getSnapshot = useCallback(
    () => readStoredValue(kind, key) ?? fallback,
    [kind, key, fallback],
  );
  const getServerSnapshot = useCallback(() => fallback, [fallback]);

  return useSyncExternalStore(
    subscribeToStorage,
    getSnapshot,
    getServerSnapshot,
  );
}
