"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Link } from "@/i18n/navigation";
import { badgeLabel, groupByDay, hrefFor } from "@/lib/notifications/render";
import type { NotificationType } from "@/lib/notifications/types";
import { cn } from "@/lib/utils";

/**
 * The bell.
 *
 * Polls rather than holding a socket: #21 puts real-time delivery in the
 * presence issue, and a websocket for a badge that changes a few times a day
 * is a connection per reader for almost no benefit. The interval is generous
 * for the same reason.
 *
 * Every sentence is composed HERE, from the message catalogue in the reader's
 * locale — never read from the row. That is why Arabic's six plural forms
 * work: ICU chooses, not an `if` in the code that built the string.
 */

interface Row {
  id: string;
  type: NotificationType;
  subjectType: string;
  subjectId: string;
  actorCount: number;
  actorName: string | null;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

const POLL_MS = 60_000;

export function NotificationBell() {
  const t = useTranslations("notifications");
  const format = useFormatter();

  const [rows, setRows] = useState<Row[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    // Silence on failure: a bell that cannot reach the server is a bell with
    // no badge, not an error the reader has to dismiss.
    try {
      const response = await fetch("/api/notifications?limit=10");
      if (!response.ok) return;
      const body = (await response.json()) as { rows: Row[]; unread: number };
      setRows(body.rows);
      setUnread(body.unread);
    } catch {
      /* offline, or signed out mid-session */
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    // Also on return: somebody coming back to a tab wants the current count,
    // not one from before they left.
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const markAllRead = async () => {
    // Optimistic: the badge clears immediately, because the reader has by
    // definition just seen them.
    setUnread(0);
    setRows((current) => current.map((row) => ({ ...row, readAt: "now" })));

    try {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
    } finally {
      await load();
    }
  };

  const badge = badgeLabel(unread);
  const groups = groupByDay(
    rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt) })),
    new Date(),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={t("open")}
        >
          <Bell aria-hidden="true" className="size-5" />
          {badge && (
            <span
              // The count is in the accessible name too, not only as a dot:
              // a badge nobody can read is decoration.
              className="absolute -end-0.5 -top-0.5 min-w-4 rounded-full bg-primary px-1 text-[10px] font-bold leading-4 text-primary-foreground"
            >
              {badge}
            </span>
          )}
          <span className="sr-only">{t("unread", { count: unread })}</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-88 p-0">
        <div className="flex items-center justify-between p-3">
          <p className="font-semibold">{t("title")}</p>
          {unread > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={markAllRead}
            >
              {t("markAllRead")}
            </Button>
          )}
        </div>
        <Separator />

        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {t("empty")}
          </p>
        ) : (
          <ScrollArea className="max-h-96">
            {groups.map((group) => (
              <section key={group.day}>
                <p className="px-3 pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t(group.day)}
                </p>
                <ul>
                  {group.rows.map((row) => {
                    const href = hrefFor(row);
                    // Cast on the VALUES rather than only the key: a
                    // dynamic key widens next-intl's inferred parameter type
                    // to `undefined`, and the values are checked by
                    // `tests/lib/notification-messages.test.ts` instead —
                    // which resolves every key the way next-intl does.
                    const message = (
                      t as unknown as (
                        key: string,
                        values: Record<string, string | number>,
                      ) => string
                    )(`messages.${row.type}`, {
                      actor: row.actorName ?? t("someone"),
                      count: Math.max(1, row.actorCount),
                    });

                    return (
                      <li key={row.id}>
                        {href ? (
                          <Link
                            href={href}
                            onClick={() => setOpen(false)}
                            className={cn(
                              "block px-3 py-2 text-sm hover:bg-muted/50",
                              !row.readAt && "font-medium",
                            )}
                          >
                            {message}
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {format.dateTime(new Date(row.createdAt), {
                                timeStyle: "short",
                              })}
                            </span>
                          </Link>
                        ) : (
                          // A tombstone rather than a link: the lesson or
                          // comment is gone, and a notification that 404s the
                          // person who clicked it is worse than one that says
                          // so.
                          <p className="px-3 py-2 text-sm text-muted-foreground">
                            {message}
                            <span className="mt-0.5 block text-xs">
                              {t("deleted")}
                            </span>
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </ScrollArea>
        )}

        <Separator />
        <div className="p-2">
          <Button variant="ghost" size="sm" asChild className="w-full">
            <Link href="/notifications" onClick={() => setOpen(false)}>
              {t("viewAll")}
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
