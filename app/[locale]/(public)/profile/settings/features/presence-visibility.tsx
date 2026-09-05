"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";

/**
 * "Who can see when you are online."
 *
 * Phrased as a positive the reader can turn off, rather than as a
 * "hide me" negative, because the setting's ON state is the platform default
 * and a switch that reads "hidden: off" takes a moment to parse.
 *
 * Turning it off also deletes the stored timestamp, not just the permission to
 * show it — which the copy says, because "we will stop showing it" and "we
 * will stop keeping it" are different promises.
 */
export function PresenceVisibility() {
  const t = useTranslations("presence");
  const [visible, setVisible] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/presence/visibility");
        if (!response.ok) return;
        const body = (await response.json()) as { visibility: string };
        if (!cancelled) setVisible(body.visibility === "everyone");
      } catch {
        /* offline: the switch stays absent rather than showing a wrong state */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const change = async (next: boolean) => {
    const previous = visible;
    setVisible(next);
    setBusy(true);

    try {
      const response = await fetch("/api/presence/visibility", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility: next ? "everyone" : "nobody" }),
      });
      if (!response.ok) throw new Error(String(response.status));
      toast.success({ title: t("visibilitySaved"), description: "" });
    } catch {
      // Back to what the server last told us: a privacy switch that shows a
      // state the server does not hold is worse than one that fails loudly.
      setVisible(previous);
      toast.error({ title: t("visibilityFailed"), description: "" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {t("visibilityDescription")}
      </p>
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="presence-visibility" className="text-sm font-normal">
          {t("visibilityTitle")}
        </Label>
        <Switch
          id="presence-visibility"
          checked={visible ?? true}
          // Until the current answer arrives the switch cannot be moved:
          // flipping an unknown state would save a value nobody chose.
          disabled={visible === null || busy}
          onCheckedChange={(next) => void change(next)}
        />
      </div>
    </div>
  );
}
