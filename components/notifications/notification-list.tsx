"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { groupByDay, hrefFor } from "@/lib/notifications/render";
import type { NotificationType } from "@/lib/notifications/types";
import { Button } from "@/components/ui/button";

/**
 * The inbox list, with the older pages loaded as they are reached.
 *
 * The FIRST page is rendered on the server and handed here as a prop. That is
 * the whole point of the split: this page *is* the notifications, so fetching
 * them on mount would show every reader a flash of nothing, while a list that
 * can only ever show fifty is not an inbox.
 *
 * Paged on the row id rather than an offset. The ids are UUID v7, so ordering
 * by id is ordering by time — and an offset would skip or repeat a row every
 * time a new notification arrived between two fetches, which on this page is
 * exactly when people are looking.
 */

export interface ListRow {
  id: string;
  type: NotificationType;
  subjectType: string;
  subjectId: string;
  actorCount: number;
  actorName: string | null;
  data: Record<string, unknown>;
  readAt: string | null;
  /** ISO 8601: this crosses the server/client boundary and comes back from
   * JSON on later pages, so one shape for both. */
  createdAt: string;
}

interface Page {
  rows: ListRow[];
  nextCursor: string | null;
}

export function NotificationList({
  initialRows,
  initialCursor,
}: {
  initialRows: ListRow[];
  initialCursor: string | null;
}) {
  const t = useTranslations("notifications");
  const format = useFormatter();

  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const sentinel = useRef<HTMLDivElement | null>(null);

  const loadMore = useCallback(async () => {
    // `loading` guards the double-fire the observer produces when the sentinel
    // is still on screen after the new rows render.
    if (!cursor || loading) return;
    setLoading(true);
    setFailed(false);

    try {
      const response = await fetch(
        `/api/notifications?limit=20&before=${encodeURIComponent(cursor)}`,
      );
      if (!response.ok) throw new Error(String(response.status));
      const page = (await response.json()) as Page;

      // Appended by id, not concatenated blindly: a notification arriving
      // between two fetches shifts nothing, but a retry after a failed request
      // would otherwise duplicate the page it already had.
      setRows((current) => {
        const seen = new Set(current.map((row) => row.id));
        return [...current, ...page.rows.filter((row) => !seen.has(row.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      // Kept, with a way to try again: an infinite list that stops silently
      // looks identical to one that has reached the end.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [cursor, loading]);

  useEffect(() => {
    const element = sentinel.current;
    // No sentinel means no more pages. Nothing to observe.
    if (!element || !cursor || failed) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      // Ahead of the fold, so the next page is usually there before the reader
      // reaches the end of this one.
      { rootMargin: "400px" },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [cursor, failed, loadMore]);

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
        {t("empty")}
      </p>
    );
  }

  const groups = groupByDay(
    rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt) })),
    new Date(),
  );

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.day} className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t(group.day)}
          </h2>
          <ul className="divide-y rounded-lg border">
            {group.rows.map((row) => {
              const href = hrefFor(row);
              // Cast on the VALUES as well as the key: a dynamic key widens
              // next-intl's inferred parameter type to `undefined`. The keys
              // themselves are checked by tests/lib/notification-messages.test.ts,
              // which resolves every one the way next-intl does.
              const message = (
                t as unknown as (
                  key: string,
                  values: Record<string, string | number>,
                ) => string
              )(`messages.${row.type}`, {
                actor: row.actorName ?? t("someone"),
                count: Math.max(1, row.actorCount),
              });
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
      ))}

      {cursor && (
        <div ref={sentinel} className="flex justify-center py-2">
          {/* A real button, not only a sentinel. The observer covers the
              ordinary case; the button covers a reader who cannot scroll to
              it, a browser without IntersectionObserver, and the retry after
              a failed page — all of which otherwise end the list silently. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void loadMore()}
            disabled={loading}
          >
            {t("loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}
