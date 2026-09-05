import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";

import { requireUser } from "@/lib/session";
import type { Locale } from "@/i18n/routing";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initialsOf } from "@/lib/initials";
import { ProfileForm } from "./features/profile-form";

// Reads the session, so there is nothing to prerender.
export const dynamic = "force-dynamic";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  // The gate. Middleware only checked that a cookie existed; this is the
  // check that decides.
  const user = await requireUser();
  const t = await getTranslations("auth");
  const format = await getFormatter();

  const displayName = user.profile?.displayName ?? user.name;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 space-y-8">
      <header className="flex items-center gap-4">
        <Avatar className="size-16">
          {user.profile?.avatarUrl && (
            <AvatarImage src={user.profile.avatarUrl} alt={t("avatarAlt")} />
          )}
          <AvatarFallback className="text-lg">
            {initialsOf(displayName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight">
            {t("profileTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("profileSubtitle")}
          </p>
          {user.profile && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("memberSince", {
                date: format.dateTime(user.profile.createdAt, {
                  year: "numeric",
                  month: "long",
                }),
              })}
            </p>
          )}
        </div>
      </header>

      <ProfileForm
        displayName={displayName}
        bio={user.profile?.bio ?? ""}
        locale={user.profile?.locale ?? "en"}
      />
    </div>
  );
}
