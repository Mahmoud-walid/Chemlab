import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";

import { getDb } from "@/db/client";
import { listNotifications, unreadCount } from "@/db/queries/notifications";
import { requireUser } from "@/lib/session";
import { groupByDay, hrefFor } from "@/lib/notifications/render";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { MarkAllRead } from "./features/mark-all-read";

export const dynamic = "force-dynamic";

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
    listNotifications(db, user.id, { limit: 50 }),
    unreadCount(db, user.id),
  ]);

  const t = await getTranslations("notifications");
  const format = await getFormatter();
  const groups = groupByDay(page.rows, new Date());

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

      {page.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.day} className="space-y-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t(group.day)}
            </h2>
            <ul className="divide-y rounded-lg border">
              {group.rows.map((row) => {
                const href = hrefFor(row);
                const message = t(
                  `messages.${row.type}` as never,
                  {
                    actor: row.actorName ?? t("someone"),
                    count: Math.max(1, row.actorCount),
                  } as never,
                );
                const when = format.dateTime(row.createdAt, {
                  dateStyle: "medium",
                  timeStyle: "short",
                });

                return (
                  <li key={row.id}>
                    {href ? (
                      <Link
                        href={href}
                        className="block p-4 hover:bg-muted/40"
                        aria-current={row.readAt ? undefined : "true"}
                      >
                        <p className={row.readAt ? "" : "font-medium"}>
                          {message}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {when}
                        </p>
                      </Link>
                    ) : (
                      /* A tombstone, not a dead link: the lesson or comment is
                         gone, and 404ing somebody who clicked their own
                         notification is worse than saying so. */
                      <div className="p-4 text-muted-foreground">
                        <p>{message}</p>
                        <p className="mt-1 text-xs">{t("deleted")}</p>
                        <p className="mt-1 text-xs">{when}</p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
