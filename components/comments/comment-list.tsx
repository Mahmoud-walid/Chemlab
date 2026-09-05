"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { CommentPageResponse, CommentView } from "@/lib/comments/types";
import { usePresence } from "@/hooks/use-presence";
import { CommentForm } from "./comment-form";
import { CommentItem } from "./comment-item";

/**
 * The discussion under a lesson.
 *
 * Three decisions here are worth stating, because each has an obvious wrong
 * version:
 *
 * 1. **New comments are buffered, never spliced.** Inserting a row above the
 *    viewport shifts everything down and the reader loses their place — the
 *    classic "the list jumped" bug. They accumulate into a pill instead, and
 *    only enter the list when somebody presses it.
 * 2. **The reader's own comment IS inserted**, immediately, without a refetch.
 *    They expect to see what they just wrote, and a spinner where their words
 *    should be reads as a failure.
 * 3. **There is a real button beside the observer sentinel.** Auto-load alone
 *    is unreachable by keyboard, and `IntersectionObserver` is throttled in
 *    background tabs — both end the list silently, which is indistinguishable
 *    from having reached the end.
 */

const PAGE_SIZE = 20;
/** How often to look for comments posted by other people. Generous: this is a
 * lesson discussion, not a chat room, and every poll is a query. */
const POLL_MS = 60_000;

async function fetchPage(
  subjectId: string,
  sort: "new" | "top",
  cursor: string | null,
): Promise<CommentPageResponse> {
  const params = new URLSearchParams({
    subjectType: "lesson",
    subjectId,
    sort,
    limit: String(PAGE_SIZE),
  });
  if (cursor) params.set("cursor", cursor);

  const response = await fetch(`/api/comments?${params.toString()}`);
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as CommentPageResponse;
}

export function CommentList({
  subjectId,
  signedIn,
  viewerId,
}: {
  subjectId: string;
  signedIn: boolean;
  /** Whose comments show a delete control. Null when signed out. */
  viewerId: string | null;
}) {
  const t = useTranslations("comments");
  const [sort, setSort] = useState<"new" | "top">("new");
  const [replyTo, setReplyTo] = useState<CommentView | null>(null);

  /** Posted here, shown immediately, and not waiting on a refetch. */
  const [mine, setMine] = useState<CommentView[]>([]);
  /** Posted by other people since the page loaded. Counted, not inserted. */
  const [buffered, setBuffered] = useState<CommentView[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const query = useInfiniteQuery({
    queryKey: ["comments", subjectId, sort],
    queryFn: ({ pageParam }) => fetchPage(subjectId, sort, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  // Memoised: a fresh array each render would make the effect below re-run on
  // every render, rebuilding a set nothing had changed.
  const loaded = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );

  /**
   * Every id already on screen or waiting in the pill.
   *
   * Kept in a ref so the POLL can read the current value without being
   * restarted on every render — an effect that depended on the set directly
   * would tear down and recreate its interval each time a comment arrived.
   * Written in an effect rather than during render: assigning to a ref while
   * rendering is a side effect, and React is entitled to render twice.
   */
  const knownIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    knownIds.current = new Set([
      ...loaded.map((item) => item.id),
      ...mine.map((item) => item.id),
      ...buffered.map((item) => item.id),
    ]);
  }, [loaded, mine, buffered]);

  // Polling for other people's comments. Deliberately compares against what is
  // already known rather than refetching the whole list: a refetch would
  // replace the rows under the reader, which is the thing this avoids.
  useEffect(() => {
    if (sort !== "new") return;

    const check = async () => {
      try {
        const page = await fetchPage(subjectId, "new", null);
        const fresh = page.items.filter(
          (item) => !knownIds.current.has(item.id),
        );
        if (fresh.length > 0) {
          setBuffered((current) => [
            ...fresh.filter(
              (item) => !current.some((existing) => existing.id === item.id),
            ),
            ...current,
          ]);
        }
      } catch {
        /* offline: the pill simply does not appear */
      }
    };

    const timer = setInterval(() => void check(), POLL_MS);
    return () => clearInterval(timer);
  }, [subjectId, sort]);

  const sentinel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = sentinel.current;
    if (!element || !query.hasNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void query.fetchNextPage();
        }
      },
      // Ahead of the fold, so the next page is usually there before the reader
      // reaches the end of this one.
      { rootMargin: "600px" },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [query]);

  const onPosted = useCallback(
    (created: { id: string; body: string; parentId: string | null }) => {
      const now = new Date().toISOString();
      const view: CommentView = {
        id: created.id,
        parentId: created.parentId,
        depth: created.parentId ? 1 : 0,
        body: created.body,
        authorId: viewerId,
        authorName: null,
        authorImage: null,
        likeCount: 0,
        dislikeCount: 0,
        replyCount: 0,
        editedAt: null,
        deletedAt: null,
        createdAt: now,
        viewerReaction: null,
      };

      if (created.parentId) {
        // A reply belongs under its root, so the thread stays readable rather
        // than the answer appearing at the top of the page.
        setMine((current) => [...current, view]);
      } else {
        setMine((current) => [view, ...current]);
      }
      setReplyTo(null);
    },
    [viewerId],
  );

  const showBuffered = () => {
    setMine((current) => [...buffered, ...current]);
    setBuffered([]);
  };

  const onDeleted = useCallback((id: string) => {
    setRemoved((current) => new Set(current).add(id));
  }, []);

  const roots = [...mine.filter((item) => item.depth === 0), ...loaded].filter(
    (item) => !removed.has(item.id),
  );
  const myReplies = mine.filter((item) => item.depth === 1);

  /**
   * One presence request for the whole page, not one per avatar.
   *
   * Only the authors currently RENDERED: under windowing the off-screen rows
   * are not mounted, and asking about people nobody can see is load for
   * nothing.
   */
  const presence = usePresence([
    ...roots.map((root) => root.authorId),
    ...roots.flatMap((root) => (root.replies ?? []).map((r) => r.authorId)),
    ...myReplies.map((reply) => reply.authorId),
  ]);

  return (
    <section className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <div className="flex gap-1">
          {(["new", "top"] as const).map((option) => (
            <Button
              key={option}
              type="button"
              variant={sort === option ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setSort(option)}
              aria-pressed={sort === option}
            >
              {option === "new" ? t("sortNew") : t("sortTop")}
            </Button>
          ))}
        </div>
      </div>

      {signedIn ? (
        <CommentForm subjectId={subjectId} onPosted={onPosted} />
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          {t("signInToComment")}
        </p>
      )}

      {buffered.length > 0 && (
        // Pinned rather than spliced: pressing it is a deliberate act, so the
        // scroll position moving is expected rather than a jump.
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-full"
          onClick={showBuffered}
        >
          {t("newComments", { count: buffered.length })}
        </Button>
      )}

      <Separator />

      {query.isPending ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t("loading")}
        </p>
      ) : roots.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div
          // `feed` is the role designed for a stream that loads as you scroll,
          // and it is what lets assistive tech announce position within the
          // TRUE total rather than within what happens to be loaded.
          role="feed"
          aria-label={t("feedLabel")}
          aria-busy={query.isFetchingNextPage}
          className="divide-y"
        >
          {roots.map((root, index) => {
            const replies = [
              ...(root.replies ?? []),
              ...myReplies.filter((reply) => reply.parentId === root.id),
            ].filter((reply) => !removed.has(reply.id));

            return (
              // A plain wrapper: the position goes on the element that IS the
              // article, below. `role="article"` here would nest two articles,
              // and a screen reader would announce the comment twice.
              <div key={root.id}>
                <CommentItem
                  comment={root}
                  signedIn={signedIn}
                  posInSet={index + 1}
                  onReply={signedIn ? setReplyTo : undefined}
                  onDeleted={
                    viewerId && root.authorId === viewerId
                      ? onDeleted
                      : undefined
                  }
                />

                {replyTo?.id === root.id && (
                  <div className="ms-11 pb-4">
                    <CommentForm
                      subjectId={subjectId}
                      replyTo={replyTo}
                      onPosted={onPosted}
                      onCancel={() => setReplyTo(null)}
                    />
                  </div>
                )}

                {replies.map((reply) => (
                  <CommentItem
                    key={reply.id}
                    comment={reply}
                    signedIn={signedIn}
                    isReply
                    onReply={signedIn ? () => setReplyTo(root) : undefined}
                    onDeleted={
                      viewerId && reply.authorId === viewerId
                        ? onDeleted
                        : undefined
                    }
                  />
                ))}

                {root.replyCount > replies.length && (
                  <ShowReplies
                    rootId={root.id}
                    known={replies.length}
                    total={root.replyCount}
                    signedIn={signedIn}
                    viewerId={viewerId}
                    onDeleted={onDeleted}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {query.hasNextPage && (
        <div ref={sentinel} className="flex justify-center py-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? t("loading") : t("loadMore")}
          </Button>
        </div>
      )}
    </section>
  );
}

/** The rest of one thread, paged on its own so a long thread cannot make the
 * feed's page unbounded. */
function ShowReplies({
  rootId,
  known,
  total,
  signedIn,
  viewerId,
  onDeleted,
}: {
  rootId: string;
  known: number;
  total: number;
  signedIn: boolean;
  viewerId: string | null;
  onDeleted: (id: string) => void;
}) {
  const t = useTranslations("comments");
  const [extra, setExtra] = useState<CommentView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Its own batch: these authors were not on the page when the list asked, so
  // folding them into that query would mean refetching the whole set every
  // time somebody expands a thread.
  const presence = usePresence(extra.map((reply) => reply.authorId));

  const load = async () => {
    setBusy(true);
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(
        `/api/comments/${rootId}/replies?${params.toString()}`,
      );
      if (!response.ok) throw new Error(String(response.status));
      const page = (await response.json()) as CommentPageResponse;

      setExtra((current) => {
        const seen = new Set(current.map((row) => row.id));
        return [...current, ...page.items.filter((row) => !seen.has(row.id))];
      });
      setCursor(page.nextCursor);
      setOpen(true);
    } catch {
      /* the button stays, so it can be tried again */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ms-6 pb-3 sm:ms-10">
      {open &&
        extra.map((reply) => (
          <CommentItem
            key={reply.id}
            comment={reply}
            signedIn={signedIn}
            isReply
            presence={reply.authorId ? presence.get(reply.authorId) : undefined}
            onDeleted={
              viewerId && reply.authorId === viewerId ? onDeleted : undefined
            }
          />
        ))}

      {(!open || cursor) && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void load()}
          disabled={busy}
        >
          {t("showReplies", {
            count: Math.max(0, total - known - extra.length),
          })}
        </Button>
      )}
    </div>
  );
}
