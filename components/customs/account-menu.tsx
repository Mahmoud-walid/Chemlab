"use client";

import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AccountMenuClient } from "./account-menu.client";
import { NotificationBell } from "@/components/notifications/notification-bell";

/**
 * The account surface in the header.
 *
 * Reads the session in the BROWSER, deliberately, even though a server read
 * would give a correct first paint. A server read calls `headers()`, and a
 * dynamic API anywhere in a layout opts every route beneath it out of static
 * rendering — which silently cost the whole public site its prerendering,
 * including 238 element and quiz pages, when this component was first added.
 *
 * A content site that works when the database is down is worth more than a
 * header that is right in the very first frame. While the session resolves the
 * slot shows a neutral placeholder rather than "Sign in", so nobody is told
 * they are signed out and then contradicted.
 *
 * The proper fix is Next's Cache Components, which prerenders the shell and
 * streams this hole behind a Suspense boundary. That is a whole-app rendering
 * change and belongs in its own piece of work — see docs/DEFERRED_QUESTIONS.md.
 */
export function AccountMenu() {
  const t = useTranslations("auth");
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      // Purely visual, and ARIA prohibits aria-label on a plain div. Hidden
      // from assistive tech rather than announced as an unnamed region: the
      // real control appears the moment the session resolves.
      <Skeleton className="size-9 rounded-full" aria-hidden="true" />
    );
  }

  if (!session?.user) {
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
    <div className="flex items-center gap-1">
      {/* Only for somebody signed in: there is nothing to notify an anonymous
          reader about, and a bell that always shows zero is furniture. */}
      <NotificationBell />
      <AccountMenuClient
        displayName={session.user.name}
        email={session.user.email}
        avatarUrl={session.user.image ?? null}
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
    </div>
  );
}
