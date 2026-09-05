"use client";

import { useEffect, useState } from "react";

/**
 * How far through the article the reader is.
 *
 * A transform on a full-width bar rather than an animated `width`: `width`
 * triggers layout on every scroll frame, `transform` does not, and this
 * updates as fast as the reader scrolls.
 *
 * **It fills from the inline start.** `scaleX` with the default origin grows
 * from the centre, and a left origin would fill from the wrong side in Arabic —
 * a progress bar that empties as an RTL reader advances. `transform-origin`
 * has no logical keyword yet, so the direction is a CSS variant
 * (`origin-left rtl:origin-right`) rather than a value read in JavaScript:
 * the correct side is then chosen before hydration, not after it.
 */
export function ReadingProgress({ label }: { label: string }) {
  const [ratio, setRatio] = useState(0);

  useEffect(() => {
    const update = () => {
      const scrollable =
        document.documentElement.scrollHeight - window.innerHeight;
      // A page shorter than the viewport has nothing to progress through;
      // dividing by zero would show it permanently complete.
      setRatio(scrollable <= 0 ? 0 : Math.min(1, window.scrollY / scrollable));
    };

    // Deferred a frame rather than called straight from the effect body: a
    // synchronous setState here is a second render before paint, and the
    // first frame's value would be zero either way.
    const first = requestAnimationFrame(update);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(first);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      className="fixed inset-x-0 top-0 z-50 h-1 bg-transparent"
    >
      <div
        className="h-full origin-left bg-primary transition-transform duration-75 rtl:origin-right"
        style={{ transform: `scaleX(${ratio})` }}
      />
    </div>
  );
}
