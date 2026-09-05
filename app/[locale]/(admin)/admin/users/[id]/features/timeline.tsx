"use client";

import { useState, useTransition } from "react";
import { useFormatter } from "next-intl";

import { loadMoreTimeline, type TimelineItem } from "../actions";
import { Button } from "@/components/ui/button";

/**
 * What this person did, newest first.
 *
 * Paged by cursor rather than by page number: the events table is append-only
 * and grows at the head, so an offset page two is a different set of rows
 * every time anybody does anything. The cursor is opaque here — it is the
 * server's business what is in it.
 *
 * Verb labels arrive already translated — `admin.activity.verbs` holds flat
 * keys containing dots, which a client namespace scoped to them resolves as
 * nesting and renders raw. Timestamps arrive as ISO and are formatted here
 * through next-intl's formatter, which carries the request's locale, so a page
 * served in Arabic formats in Arabic rather than in whatever the browser
 * happens to prefer.
 */
export function Timeline({
  userId,
  initial,
  initialCursor,
  labels,
}: {
  userId: string;
  initial: TimelineItem[];
  initialCursor: string | null;
  labels: { more: string; loading: string; end: string; empty: string };
}) {
  const format = useFormatter();
  const [pending, startTransition] = useTransition();
  const [entries, setEntries] = useState(initial);
  const [cursor, setCursor] = useState(initialCursor);

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{labels.empty}</p>;
  }

  function more() {
    if (!cursor) return;
    startTransition(async () => {
      const page = await loadMoreTimeline({ userId, cursor: cursor! });
      // Appended rather than replaced, and de-duplicated by id: the cursor
      // makes a repeat impossible, but a double click should not be able to
      // prove otherwise.
      setEntries((current) => {
        const seen = new Set(current.map((entry) => entry.id));
        return [
          ...current,
          ...page.entries.filter((entry) => !seen.has(entry.id)),
        ];
      });
      setCursor(page.nextCursor);
    });
  }

  return (
    <div className="space-y-3">
      <ol className="divide-y rounded-lg border">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="flex flex-wrap items-baseline justify-between gap-2 p-3 text-sm"
          >
            <span>
              {entry.label}
              {entry.objectType && (
                <span className="ms-2 text-xs text-muted-foreground">
                  {entry.objectType}
                </span>
              )}
            </span>
            <time className="text-xs text-muted-foreground">
              {format.dateTime(new Date(entry.at), {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </time>
          </li>
        ))}
      </ol>

      {cursor ? (
        <Button variant="outline" onClick={more} disabled={pending}>
          {pending ? labels.loading : labels.more}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">{labels.end}</p>
      )}
    </div>
  );
}
