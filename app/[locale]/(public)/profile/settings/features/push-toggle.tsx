"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import {
  canPrompt,
  pushState,
  readEnvironment,
  shouldResubscribe,
  type PushState,
} from "@/lib/push/permission";

/**
 * Turning notifications on for this device.
 *
 * The prompt happens HERE — on a button, on a settings page the reader chose
 * to open — and never on page load. A permission dialog on first paint is the
 * most reliable way to be refused for ever, because a browser that has been
 * refused will not show its dialog again no matter how good the reason is
 * later.
 *
 * Every state gets different copy, because the right thing to say differs and
 * a button that cannot work is worse than no button. The iOS case is the one
 * that matters most: a plain Safari tab can never receive a push, so it gets
 * instructions rather than a control.
 */
export interface PushToggleLabels {
  enable: string;
  enabling: string;
  enabled: string;
  disable: string;
  unsupported: string;
  denied: string;
  iosInstall: string;
  failed: string;
  description: string;
}

/**
 * The VAPID public key, base64url, as `applicationServerKey` wants it.
 *
 * Built on an explicit `ArrayBuffer` because that is what the DOM types
 * require: a `Uint8Array` backed by a `SharedArrayBuffer` is not a
 * `BufferSource`, and the two are indistinguishable without the annotation.
 */
function toApplicationServerKey(base64url: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding)
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  const raw = atob(base64);

  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buffer;
}

export function PushToggle({
  vapidPublicKey,
  labels,
}: {
  /** Absent when the deployment has no VAPID keys — the control is hidden
   * rather than offering something that cannot work. */
  vapidPublicKey: string | null;
  labels: PushToggleLabels;
}) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * Whether the silent re-subscribe below has already been tried.
   *
   * A ref rather than state, and the whole point of it. The effect that runs
   * it depends on `state` and `busy`, and a failed attempt sets both back to
   * what they were — so without a latch it fires again the moment `busy`
   * clears, and again, for ever. That is not theoretical: it shipped, and it
   * spent a toast, a `pushManager.subscribe()` and a POST per iteration.
   */
  const autoAttempted = useRef(false);
  /** A failed silent attempt has to leave a way forward, or the card is a
   * paragraph with no control in it. */
  const [autoFailed, setAutoFailed] = useState(false);

  const refresh = useCallback(async () => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      setState("unsupported");
      return null;
    }

    const registration = await navigator.serviceWorker.ready.catch(() => null);
    const subscription = registration
      ? await registration.pushManager.getSubscription().catch(() => null)
      : null;

    setState(pushState(readEnvironment(subscription !== null)));
    return registration;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const subscribe = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!vapidPublicKey) return;
      setBusy(true);

      try {
        const registration = await navigator.serviceWorker.ready;

        const subscription = await registration.pushManager.subscribe({
          // Required by every browser: a push that shows nothing is a push
          // that can be used to track people silently, so they refuse to
          // allow one.
          userVisibleOnly: true,
          applicationServerKey: toApplicationServerKey(vapidPublicKey),
        });

        const response = await fetch("/api/push/subscriptions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(subscription.toJSON()),
        });
        if (!response.ok) throw new Error(String(response.status));

        setAutoFailed(false);
        await refresh();
      } catch {
        // Silent means silent. The re-subscribe below runs because the reader
        // opened a settings page, not because they asked for anything — so a
        // red toast blames them for a failure they did not cause and cannot
        // read the cause of. It leaves a button instead.
        //
        // A subscribe the reader DID press still reports, because there the
        // toast answers a question they just asked. That includes dismissing
        // the browser's own dialog, which is not alarming but is an answer.
        if (silent) setAutoFailed(true);
        else toast.error({ title: labels.failed, description: "" });
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [vapidPublicKey, labels.failed, refresh],
  );

  const unsubscribe = useCallback(async () => {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) return;

      // The server first: unsubscribing locally and failing to tell the server
      // leaves a row that will be pushed to until the service says it is gone.
      await fetch("/api/push/subscriptions", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      await subscription.unsubscribe();
      await refresh();
    } catch {
      toast.error({ title: labels.failed, description: "" });
    } finally {
      setBusy(false);
    }
  }, [labels.failed, refresh]);

  // Permission already granted but no subscription — the reader said yes and
  // something dropped the endpoint. Re-subscribe silently rather than asking
  // them to re-consent to something they never withdrew.
  //
  // ONCE per mount, and the latch is the load-bearing part. `subscribe()`
  // ends by refreshing the state and clearing `busy`, and when it fails both
  // land back exactly where this effect's condition wants them: still
  // `granted-unsubscribed`, no longer busy. Without the ref it re-fires on
  // that very change and loops for as long as the page is open — a toast, a
  // `pushManager.subscribe()` and a POST to /api/push/subscriptions per turn.
  // Retrying on an interval would be the same bug with a timer in front of
  // it; the manual button below is the retry.
  useEffect(() => {
    if (!state || !vapidPublicKey) return;
    if (!shouldResubscribe(state)) return;
    if (autoAttempted.current) return;

    autoAttempted.current = true;
    void subscribe({ silent: true });
  }, [state, vapidPublicKey, subscribe]);

  if (!vapidPublicKey || state === null) return null;

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{labels.description}</p>

      {state === "ios-needs-install" && (
        // Not a button: on iOS Safari in a tab, `requestPermission()` throws
        // or resolves denied, and either way spends the one chance to ask.
        <p className="rounded-lg border border-dashed p-3 text-sm">
          {labels.iosInstall}
        </p>
      )}

      {state === "unsupported" && (
        <p className="rounded-lg border border-dashed p-3 text-sm">
          {labels.unsupported}
        </p>
      )}

      {state === "denied" && (
        // No button. The browser will not show its dialog again, so one that
        // "asks" would do nothing and look broken.
        <p className="rounded-lg border border-dashed p-3 text-sm">
          {labels.denied}
        </p>
      )}

      {(canPrompt(state) || (shouldResubscribe(state) && autoFailed)) && (
        // The second case is the one that was missing. `granted-unsubscribed`
        // matched no branch at all, so a reader whose silent re-subscribe had
        // failed got a heading, a sentence and nothing to press — and the only
        // sign anything was wrong was the toast, which is now suppressed. A
        // state with no way out of it is worse than an error message.
        <Button
          type="button"
          variant="outline"
          onClick={() => void subscribe()}
          disabled={busy}
          className="gap-2"
        >
          <Bell aria-hidden="true" className="size-4" />
          {busy ? labels.enabling : labels.enable}
        </Button>
      )}

      {state === "subscribed" && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium">{labels.enabled}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={unsubscribe}
            disabled={busy}
            className="gap-2"
          >
            <BellOff aria-hidden="true" className="size-4" />
            {labels.disable}
          </Button>
        </div>
      )}
    </div>
  );
}
