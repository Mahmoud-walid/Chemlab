"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import {
  NOTIFICATION_TYPES,
  type NotificationType,
} from "@/lib/notifications/types";

/**
 * Per-category notification preferences.
 *
 * One switch per category, saved as it is flipped rather than behind a Save
 * button: there is nothing to review and nothing that needs several fields to
 * be consistent, so a button would only be a way to lose a change by leaving
 * the page.
 *
 * Each save sends ONLY the switch that moved. A form that sent the whole
 * object would overwrite a field it was rendered before it changed — two tabs
 * open, and the later save silently undoes the earlier one's unrelated switch.
 *
 * The optimistic flip is reverted on failure, and says so. A switch that
 * springs back with no explanation reads as a broken control; one that stays
 * on while the server disagrees is worse, because the person believes they
 * turned something off.
 */

interface Preferences {
  categories: Partial<Record<NotificationType, boolean>>;
  pushEnabled: boolean;
}

/** Defaults live in the catalogue; this only needs the current answer. */
export function NotificationPreferences({
  defaults,
}: {
  /** Each category's platform default, from `NOTIFICATION_SPECS`. */
  defaults: Record<NotificationType, boolean>;
}) {
  const t = useTranslations("notifications.preferences");
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [saving, setSaving] = useState<NotificationType | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/notifications/preferences");
        if (!response.ok) return;
        const body = (await response.json()) as Preferences;
        if (!cancelled) setPreferences(body);
      } catch {
        /* offline: the switches stay absent rather than showing a wrong state */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const enabled = useCallback(
    (type: NotificationType) => preferences?.categories[type] ?? defaults[type],
    [preferences, defaults],
  );

  const toggle = useCallback(
    async (type: NotificationType, next: boolean) => {
      if (!preferences) return;

      const previous = preferences;
      setPreferences({
        ...preferences,
        categories: { ...preferences.categories, [type]: next },
      });
      setSaving(type);

      try {
        const response = await fetch("/api/notifications/preferences", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ categories: { [type]: next } }),
        });
        if (!response.ok) throw new Error(String(response.status));

        setPreferences((await response.json()) as Preferences);
      } catch {
        // Back to what the server last told us, so the control never claims a
        // state the server does not hold.
        setPreferences(previous);
        toast.error({ title: t("failed"), description: "" });
      } finally {
        setSaving(null);
      }
    },
    [preferences, t],
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("description")}</p>

      <ul className="space-y-3">
        {NOTIFICATION_TYPES.map((type) => {
          const id = `notification-${type.replace(".", "-")}`;
          return (
            <li key={type} className="flex items-center justify-between gap-4">
              <Label htmlFor={id} className="text-sm font-normal">
                {t(`types.${type}` as never)}
              </Label>
              <Switch
                id={id}
                checked={enabled(type)}
                // Until the current answer arrives, the switch shows the
                // default and cannot be moved: flipping an unknown state would
                // save a value the person never chose.
                disabled={preferences === null || saving === type}
                onCheckedChange={(next) => void toggle(type, next)}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
