import { getTranslations, setRequestLocale } from "next-intl/server";

import { requireUser } from "@/lib/session";
import type { Locale } from "@/i18n/routing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

/**
 * Account settings.
 *
 * Everything editable today lives on `/profile`; this route exists because the
 * account menu points at it and because account linking, notification
 * preferences and connected devices land here in later issues. It shows what
 * is true now — the account and how it signs in — rather than a form of
 * disabled controls.
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

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight">{t("settings")}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("account")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p className="text-muted-foreground">{t("email")}</p>
          <p className="font-medium">{user.email}</p>
        </CardContent>
      </Card>
    </div>
  );
}
