"use client";

import { useFormatter, useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { isVisibleState, type PresenceState } from "@/lib/presence/state";

/**
 * The dot.
 *
 * Three things it deliberately does:
 *
 * - **Renders nothing for `unknown`.** When presence cannot be read, it is
 *   absent, not offline. A grey dot would be a claim.
 * - **Is never colour alone.** The state is in the accessible name and the
 *   title, so a colour-blind reader gets it from a screen reader or a tooltip
 *   rather than from a hue.
 * - **Sits on the inline end**, so it lands on the correct side under RTL —
 *   `end-0` rather than `right-0`.
 */
export function PresenceDot({
  state,
  lastSeenAt,
  className,
}: {
  state: PresenceState;
  lastSeenAt?: string | null;
  className?: string;
}) {
  const t = useTranslations("presence");
  const format = useFormatter();

  if (!isVisibleState(state)) return null;

  const label =
    state === "online"
      ? t("online")
      : state === "away"
        ? t("away")
        : lastSeenAt
          ? t("lastSeen", {
              when: format.relativeTime(new Date(lastSeenAt)),
            })
          : t("offline");

  return (
    <span
      // `title` for a pointer, `aria-label` with `role="img"` for a screen
      // reader: the state must be reachable without seeing the colour.
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "absolute bottom-0 end-0 size-2.5 rounded-full ring-2 ring-background",
        state === "online" && "bg-emerald-500",
        state === "away" && "bg-amber-500",
        state === "offline" && "bg-muted-foreground/40",
        className,
      )}
    />
  );
}
