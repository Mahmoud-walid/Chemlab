import { getTranslations, setRequestLocale } from "next-intl/server";

import { requireUser } from "@/lib/session";
import { env } from "@/lib/env";
import { PushToggle } from "./features/push-toggle";
import { NotificationPreferences } from "./features/notification-preferences";
import { PresenceVisibility } from "./features/presence-visibility";
import {
  NOTIFICATION_SPECS,
  NOTIFICATION_TYPES,
  type NotificationType,
} from "@/lib/notifications/types";
import type { Locale } from "@/i18n/routing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

/**
 * Account settings.
 *
 * Everything editable today lives on `/profile`; this route exists because the
 * account menu points at it and because account linking and per-category
 * notification preferences (#21) land here. It shows what is true now rather
 * than a form of disabled controls.
 *
 * The push toggle is where the permission prompt lives: on a page the reader
 * chose to open, behind a button they chose to press. A prompt on first paint
 * is the most reliable way to be refused for ever.
 */
export default async function ProfileSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  const user = await requireUser();
  const t = await getTranslations("auth");
  const tPreferences = await getTranslations("notifications.preferences");
  const tPresence = await getTranslations("presence");

  const defaults = Object.fromEntries(
    NOTIFICATION_TYPES.map((type) => [
      type,
      NOTIFICATION_SPECS[type].defaultOn,
    ]),
  ) as Record<NotificationType, boolean>;

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight">{t("settings")}</h1>

      <Card>
        <CardHeader>
          {/* A heading, not the div `CardTitle` renders by default: a
              settings page whose sections are not headings cannot be
              navigated by a screen reader, which lands on one long run of
              text with no structure. */}
          <CardTitle className="text-base">
            <h2>{t("account")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p className="text-muted-foreground">{t("email")}</p>
          <p className="font-medium">{user.email}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <h2>{t("notifications")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Absent when the deployment has no VAPID keys: a control that
              cannot work is worse than no control. */}
          <PushToggle
            vapidPublicKey={env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null}
            labels={{
              description: t("pushDescription"),
              enable: t("pushEnable"),
              enabling: t("pushEnabling"),
              enabled: t("pushEnabled"),
              disable: t("pushDisable"),
              unsupported: t("pushUnsupported"),
              denied: t("pushDenied"),
              iosInstall: t("pushIosInstall"),
              failed: t("pushFailed"),
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <h2>{tPreferences("title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* The defaults come from the catalogue rather than the client, so
              a switch a person has never touched shows what the platform
              would actually do. */}
          <NotificationPreferences defaults={defaults} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <h2>{tPresence("visibilityTitle")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PresenceVisibility />
        </CardContent>
      </Card>
    </div>
  );
}
