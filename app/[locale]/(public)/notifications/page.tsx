import { getTranslations, setRequestLocale } from "next-intl/server";

import { getDb } from "@/db/client";
import { listNotifications, unreadCount } from "@/db/queries/notifications";
import { requireUser } from "@/lib/session";
import type { Locale } from "@/i18n/routing";
import { MarkAllRead } from "./features/mark-all-read";
import { NotificationList } from "@/components/notifications/notification-list";

export const dynamic = "force-dynamic";

/** Matches the page the list asks for as it scrolls, so the boundary between
 * the server's page and the first fetched one is not a visible seam. */
const PAGE_SIZE = 20;

/**
 * The whole inbox.
 *
 * Server-rendered rather than fetched, unlike the bell: this page IS the
 * notifications, so rendering an empty shell and filling it in afterwards
 * would show every reader a flash of nothing. The bell polls because it is
 * chrome on pages about something else.
 *
 * Every sentence is composed here from the reader's own locale. Nothing
 * user-facing is stored — see db/schema/notifications.ts for why that is not
 * merely tidy but the only way Arabic's plural forms can work.
 */
export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  const user = await requireUser();
  const db = getDb();

  const [page, unread] = await Promise.all([
    listNotifications(db, user.id, { limit: PAGE_SIZE }),
    unreadCount(db, user.id),
  ]);

  const t = await getTranslations("notifications");

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("unread", { count: unread })}
          </p>
        </div>
        {unread > 0 && <MarkAllRead label={t("markAllRead")} />}
      </div>

      {/* The first page is rendered from the server's own read, and the list
          takes over from there. Fetching it on mount instead would show every
          reader a flash of nothing on the one page that IS the content. */}
      <NotificationList
        initialRows={page.rows.map((row) => ({
          ...row,
          readAt: row.readAt ? row.readAt.toISOString() : null,
          createdAt: row.createdAt.toISOString(),
        }))}
        initialCursor={page.nextCursor}
      />
    </div>
  );
}
