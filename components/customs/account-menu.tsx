import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { authConfigured, getServerEnv } from "@/lib/env.server";
import { getCurrentUser } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { AccountMenuClient } from "./account-menu.client";

/**
 * The account surface in the header.
 *
 * A server component, so the signed-in state is correct in the first paint:
 * reading the session on the client would flash "Sign in" at someone who is
 * already signed in, on every navigation.
 *
 * Renders nothing at all when auth is not configured — the site works without
 * accounts, and an inert Sign in button that 500s is worse than no button.
 */
export async function AccountMenu() {
  if (!authConfigured(getServerEnv())) return null;

  const t = await getTranslations("auth");
  const user = await getCurrentUser();

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/sign-in">{t("signIn")}</Link>
        </Button>
        <Button size="sm" asChild>
          <Link href="/sign-up">{t("signUp")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <AccountMenuClient
      displayName={user.profile?.displayName ?? user.name}
      email={user.email}
      avatarUrl={user.profile?.avatarUrl ?? user.image}
      labels={{
        openMenu: t("openAccountMenu"),
        avatarAlt: t("avatarAlt"),
        profile: t("profile"),
        myExams: t("myExams"),
        savedItems: t("savedItems"),
        settings: t("settings"),
        signOut: t("signOut"),
        signedOut: t("signedOut"),
      }}
    />
  );
}
