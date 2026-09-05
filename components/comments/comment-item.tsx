"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ThumbsDown,
  ThumbsUp,
  MessageSquare,
  Flag,
  Trash2,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { initialsOf } from "@/lib/initials";
import { cn } from "@/lib/utils";
import {
  COLLAPSE_MS,
  applyReaction,
  reactionRequest,
  type ReactionState,
} from "@/lib/comments/optimistic";
import type { CommentView } from "@/lib/comments/types";
import { CommentText } from "./comment-text";

/**
 * One comment, with its reactions.
 *
 * The reaction is optimistic and rolls back on failure, with a toast. The
 * alternative — waiting for the round trip — makes a like feel broken on a
 * slow connection; the alternative to rolling back is a control that quietly
 * disagrees with the database until the next reload.
 *
 * Rapid toggling is COLLAPSED: five clicks in a second are one decision, and
 * five requests race each other so the row ends up holding whichever lost.
 * The timer sends the final state once.
 */
export function CommentItem({
  comment,
  signedIn,
  isReply = false,
  posInSet,
  onReply,
  onDeleted,
}: {
  comment: CommentView;
  signedIn: boolean;
  isReply?: boolean;
  /** 1-based position within the feed. Only roots carry one — a reply is part
   * of its root's article, not a separate item in the stream. */
  posInSet?: number;
  onReply?: (comment: CommentView) => void;
  onDeleted?: (id: string) => void;
}) {
  const t = useTranslations("comments");
  const format = useFormatter();

  const [state, setState] = useState<ReactionState>({
    likeCount: comment.likeCount,
    dislikeCount: comment.dislikeCount,
    viewerReaction: comment.viewerReaction,
  });
  const [busy, setBusy] = useState(false);

  // The state the server should end up holding. A ref rather than state: the
  // timer reads the LATEST value, and re-rendering on every press would reset
  // the window.
  const pending = useRef<ReactionState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What to roll back to. Captured once per burst, not per press, or a
  // rollback would land on an intermediate state nobody chose.
  const committed = useRef<ReactionState>(state);

  const flushRef = useRef<() => void>(() => {});

  /**
   * A press that is still inside the collapse window when the reader leaves
   * must not be lost.
   *
   * The window exists so five clicks are one request; it is not permission to
   * drop the one click somebody made before navigating. `pagehide` is the
   * event that fires on a real navigation and on the bfcache path, and
   * `keepalive` lets the request outlive the document — a plain `fetch` is
   * cancelled with the page, which is exactly how a like disappears on
   * reload.
   */
  useEffect(() => {
    const onHide = () => flushRef.current();
    window.addEventListener("pagehide", onHide);

    return () => {
      window.removeEventListener("pagehide", onHide);
      if (timer.current) clearTimeout(timer.current);
      // Unmounting is leaving too — a comment scrolled out of a virtualised
      // list, or a route change.
      flushRef.current();
    };
  }, []);

  const flush = useCallback(async () => {
    const target = pending.current;
    pending.current = null;
    if (!target) return;

    const request = reactionRequest(target);
    try {
      const response = await fetch(`/api/comments/${comment.id}/reaction`, {
        method: request.method,
        headers: { "content-type": "application/json" },
        body:
          request.method === "PUT"
            ? JSON.stringify({ type: request.type })
            : undefined,
        // Survives the document being torn down mid-flight.
        keepalive: true,
      });
      if (!response.ok) throw new Error(String(response.status));
      committed.current = target;
    } catch {
      setState(committed.current);
      toast.error({ title: t("reactionFailed"), description: "" });
    }
  }, [comment.id, t]);

  useEffect(() => {
    flushRef.current = () => {
      if (timer.current) clearTimeout(timer.current);
      void flush();
    };
  }, [flush]);

  const press = (type: "like" | "dislike") => {
    if (!signedIn) {
      // Not a silent no-op: the click was real, and a control that appears to
      // work and vanishes on reload is worse than being told what would make
      // it work.
      toast.error({ title: t("signInToReact"), description: "" });
      return;
    }

    setState((current) => {
      const next = applyReaction(current, type);
      pending.current = next;
      return next;
    });

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), COLLAPSE_MS);
  };

  const remove = async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/comments/${comment.id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(String(response.status));
      onDeleted?.(comment.id);
    } catch {
      toast.error({ title: t("deleteFailed"), description: "" });
    } finally {
      setBusy(false);
    }
  };

  const report = async () => {
    try {
      await fetch(`/api/comments/${comment.id}/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "other" }),
      });
      // The same message whether or not a report already existed: telling a
      // reporter "you already reported this" is no use to them.
      toast.success({ title: t("reported"), description: "" });
    } catch {
      toast.error({ title: t("reportFailed"), description: "" });
    }
  };

  const deleted = comment.deletedAt !== null;

  return (
    <article
      id={`comment-${comment.id}`}
      // `article` inside the list's `role="feed"`, which is what lets a screen
      // reader move between comments as units.
      aria-posinset={posInSet}
      // -1 rather than a guess: the true total is not known until the last
      // page is fetched, and `role="feed"` defines -1 as exactly that. A
      // number that is merely "what has loaded" would announce "3 of 20" on a
      // thread of four hundred.
      aria-setsize={posInSet === undefined ? undefined : -1}
      className={cn(
        "flex gap-3 py-4",
        // Indented on the INLINE start, so Arabic indents from the right.
        isReply && "ms-6 border-s ps-4 sm:ms-10",
      )}
    >
      <Avatar className="size-8 shrink-0">
        {comment.authorImage && (
          <AvatarImage src={comment.authorImage} alt="" />
        )}
        <AvatarFallback className="text-xs">
          {initialsOf(comment.authorName ?? "?")}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-medium">
            {comment.authorName ?? t("someone")}
          </span>
          <time
            dateTime={comment.createdAt}
            className="text-xs text-muted-foreground"
          >
            {format.dateTime(new Date(comment.createdAt), {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </time>
          {comment.editedAt && (
            // Said, not hidden: a body that changed after people replied to it
            // is something the reader should know.
            <span className="text-xs text-muted-foreground">{t("edited")}</span>
          )}
        </div>

        {deleted ? (
          <p className="text-sm italic text-muted-foreground">
            {t("deletedBody")}
          </p>
        ) : (
          <CommentText body={comment.body} />
        )}

        {!deleted && (
          <div className="flex flex-wrap items-center gap-1 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => press("like")}
              aria-pressed={state.viewerReaction === "like"}
              aria-label={t("like")}
              className="gap-1.5 px-2"
            >
              <ThumbsUp
                aria-hidden="true"
                className={cn(
                  "size-4",
                  state.viewerReaction === "like" && "fill-current",
                )}
              />
              <span className="text-xs tabular-nums">{state.likeCount}</span>
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => press("dislike")}
              aria-pressed={state.viewerReaction === "dislike"}
              aria-label={t("dislike")}
              className="gap-1.5 px-2"
            >
              <ThumbsDown
                aria-hidden="true"
                className={cn(
                  "size-4",
                  state.viewerReaction === "dislike" && "fill-current",
                )}
              />
              <span className="text-xs tabular-nums">{state.dislikeCount}</span>
            </Button>

            {onReply && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onReply(comment)}
                className="gap-1.5 px-2"
              >
                <MessageSquare aria-hidden="true" className="size-4" />
                <span className="text-xs">{t("reply")}</span>
              </Button>
            )}

            {signedIn && onDeleted && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void remove()}
                disabled={busy}
                aria-label={t("delete")}
                className="px-2"
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
            )}

            {signedIn && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void report()}
                aria-label={t("report")}
                className="px-2"
              >
                <Flag aria-hidden="true" className="size-4" />
              </Button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
