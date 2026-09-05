"use client";

import { useEffect, useState } from "react";

import type { TocEntry } from "@/lib/lessons/blocks";
import { cn } from "@/lib/utils";

/**
 * The table of contents, derived from the heading blocks.
 *
 * Plain anchors, so it works before hydration and a middle-click opens a
 * section in a new tab. The only JavaScript is the active-entry highlight,
 * which is an enhancement: with it off, the list still navigates.
 *
 * `IntersectionObserver` rather than a scroll handler comparing offsets —
 * the browser does the geometry off the main thread, and the alternative
 * recomputes every heading's position on every frame of a scroll.
 */
export function TableOfContents({
  entries,
  label,
}: {
  entries: TocEntry[];
  label: string;
}) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (entries.length === 0) return;

    const observer = new IntersectionObserver(
      (records) => {
        // The topmost heading currently on screen wins. Taking the last
        // intersecting one instead makes the highlight jump to the bottom of
        // the viewport, which is not where the reader is looking.
        const visible = records
          .filter((record) => record.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      // A band near the top of the viewport: a heading is "current" from when
      // it reaches the top until the next one does, not while it is anywhere
      // on screen.
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 },
    );

    for (const entry of entries) {
      const node = document.getElementById(entry.anchor);
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, [entries]);

  if (entries.length === 0) return null;

  return (
    <nav aria-label={label} className="text-sm">
      <p className="mb-3 font-semibold">{label}</p>
      <ol className="space-y-2 border-s ps-4">
        {entries.map((entry) => (
          <li key={entry.id} className={cn(entry.level === 3 && "ps-4")}>
            <a
              href={`#${entry.anchor}`}
              aria-current={entry.anchor === active ? "location" : undefined}
              className={cn(
                "block underline-offset-4 hover:underline",
                entry.anchor === active
                  ? "font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
