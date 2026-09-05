"use client";

import { useEffect, useState, useTransition } from "react";
import { Bookmark, BookmarkCheck, Heart, Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import {
  isCounted,
  shareLesson,
  type ShareOutcome,
} from "@/lib/share/share-lesson";

/**
 * Like, save, share.
 *
 * Optimistic, with a real rollback: the count moves before the request
 * finishes, and moves BACK with a toast if it fails. The alternative — waiting
 * for the round trip — makes a like feel broken on a slow connection, and the
 * alternative to rolling back is a UI that quietly disagrees with the database
 * until the next reload.
 *
 * The server's response replaces the optimistic value rather than being
 * ignored. The counts come from database triggers, so the number in the
 * response is the true one; keeping the local guess would mean two people
 * liking at once each see their own arithmetic.
 *
 * State is fetched on mount rather than passed in from the page, because the
 * page is PRERENDERED: a count rendered on the server would be the count at
 * build time — wrong by the first like, and wrong in a way that looks
 * authoritative. Until it arrives the buttons render without numbers rather
 * than with a zero, which would be a claim.
 */

export interface EngagementState {
  likeCount: number;
  shareCount: number;
  likedByViewer: boolean | null;
  savedByViewer: boolean | null;
}

/** Nothing known yet: the counts have not arrived and no claim is made. */
const UNKNOWN: EngagementState = {
  likeCount: 0,
  shareCount: 0,
  likedByViewer: null,
  savedByViewer: null,
};

export interface EngagementLabels {
  like: string;
  liked: string;
  save: string;
  saved: string;
  share: string;
  shareCopied: string;
  shareFailed: string;
  signInToLike: string;
  failed: string;
}

export function EngagementBar({
  slug,
  title,
  labels,
}: {
  slug: string;
  title: string;
  labels: EngagementLabels;
}) {
  const [state, setState] = useState(UNKNOWN);
  const [loaded, setLoaded] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;

    // Failure is silence: the buttons still work, they just show no counts,
    // and interrupting a reader because a number could not be fetched would be
    // worse than the missing number.
    void fetch(`/api/lessons/${encodeURIComponent(slug)}/engagement`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: EngagementState | null) => {
        if (cancelled || !body) return;
        setState(body);
        setLoaded(true);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [slug]);

  /** Signed out — or not known yet. Either way there is nothing to toggle,
   * and the click was real, so say what would let it work. */
  const signedOut = state.likedByViewer === null;

  const send = async (
    path: string,
    method: "POST" | "DELETE",
    body?: unknown,
  ) => {
    const response = await fetch(
      `/api/lessons/${encodeURIComponent(slug)}${path}`,
      {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    if (!response.ok) throw new Error(String(response.status));
    return (await response.json()) as EngagementState;
  };

  const toggleLike = () => {
    if (signedOut) {
      toast.error({ title: labels.signInToLike, description: "" });
      return;
    }

    const previous = state;
    const liking = !state.likedByViewer;
    setState({
      ...state,
      likedByViewer: liking,
      // Clamped at zero: an optimistic decrement below zero would show "-1"
      // for as long as the request takes.
      likeCount: Math.max(0, state.likeCount + (liking ? 1 : -1)),
    });

    startTransition(async () => {
      try {
        setState(await send("/like", liking ? "POST" : "DELETE"));
      } catch {
        setState(previous);
        toast.error({ title: labels.failed, description: "" });
      }
    });
  };

  const toggleSave = () => {
    if (signedOut) {
      toast.error({ title: labels.signInToLike, description: "" });
      return;
    }

    const previous = state;
    const saving = !state.savedByViewer;
    setState({ ...state, savedByViewer: saving });

    startTransition(async () => {
      try {
        setState(await send("/save", saving ? "POST" : "DELETE"));
      } catch {
        setState(previous);
        toast.error({ title: labels.failed, description: "" });
      }
    });
  };

  const share = () => {
    startTransition(async () => {
      const url = window.location.href;
      const result: ShareOutcome = await shareLesson({ title, url });

      // The rule this whole feature exists for: only an outcome that actually
      // happened is sent. A dismissed share sheet posts nothing at all.
      if (!isCounted(result)) {
        if (result.outcome === "failed") {
          toast.error({ title: labels.shareFailed, description: url });
        }
        return;
      }

      if (result.channel === "clipboard") {
        toast.success({ title: labels.shareCopied, description: "" });
      }

      try {
        setState(await send("/share", "POST", { channel: result.channel }));
      } catch {
        // The share HAPPENED — the link is on their clipboard or in another
        // app. Failing to record it is our problem, not something to interrupt
        // the reader about, so the count simply stays where it was.
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={toggleLike}
        disabled={pending}
        aria-pressed={state.likedByViewer ?? false}
        className="gap-2"
      >
        <Heart
          aria-hidden="true"
          className={cn("size-4", state.likedByViewer && "fill-current")}
        />
        {state.likedByViewer ? labels.liked : labels.like}
        {loaded && (
          <span className="tabular-nums text-muted-foreground">
            {state.likeCount}
          </span>
        )}
      </Button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={toggleSave}
        disabled={pending}
        aria-pressed={state.savedByViewer ?? false}
        className="gap-2"
      >
        {state.savedByViewer ? (
          <BookmarkCheck aria-hidden="true" className="size-4" />
        ) : (
          <Bookmark aria-hidden="true" className="size-4" />
        )}
        {state.savedByViewer ? labels.saved : labels.save}
      </Button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={share}
        disabled={pending}
        className="gap-2"
      >
        <Share2 aria-hidden="true" className="size-4" />
        {labels.share}
        {/* Verified shares only. Lower than a click-counter would report, and
            true — see lib/share/share-lesson.ts. */}
        {loaded && (
          <span className="tabular-nums text-muted-foreground">
            {state.shareCount}
          </span>
        )}
      </Button>
    </div>
  );
}
