/**
 * Small wrapper around web storage that is safe to call during SSR and in
 * browsers that block storage access, plus a subscription so React components
 * can re-render when a value changes (see `hooks/use-stored-value.ts`).
 */
export type StorageKind = "local" | "session";

const listeners = new Set<() => void>();

function getStorage(kind: StorageKind): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeToStorage(listener: () => void): () => void {
  listeners.add(listener);
  // Keep other tabs in sync too.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function readStoredValue(kind: StorageKind, key: string): string | null {
  try {
    return getStorage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStoredValue(
  kind: StorageKind,
  key: string,
  value: string,
): void {
  try {
    getStorage(kind)?.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode, quota); ignore.
  }
  emit();
}

export function removeStoredValue(kind: StorageKind, key: string): void {
  try {
    getStorage(kind)?.removeItem(key);
  } catch {
    // Ignore, as above.
  }
  emit();
}
