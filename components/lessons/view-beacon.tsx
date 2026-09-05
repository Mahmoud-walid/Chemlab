"use client";

import { useEffect, useRef } from "react";

/**
 * Records that somebody read this lesson.
 *
 * A client beacon rather than a write from the page, because the page is
 * PRERENDERED. `after()` inside a static page runs at build time, so a view
 * recorded there would count the build once and never count a reader —
 * `lib/activity/funnel.ts` names this exact trap. Making the page dynamic to
 * record a view would trade every lesson's prerender for one row.
 *
 * `keepalive` so the request survives the reader navigating away immediately,
 * and a ref so React's development double-invoke does not count two views for
 * one visit.
 */
export function ViewBeacon({ slug }: { slug: string }) {
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;

    // Failure is silence, deliberately: a reader must never see an error
    // because analytics could not be recorded, and a missing event is a
    // missing row, not a broken page.
    void fetch(`/api/lessons/${encodeURIComponent(slug)}/view`, {
      method: "POST",
      keepalive: true,
    }).catch(() => {});
  }, [slug]);

  return null;
}
