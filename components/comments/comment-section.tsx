"use client";

import { useSession } from "@/lib/auth-client";
import { CommentList } from "./comment-list";

/**
 * The discussion, mounted on a PRERENDERED lesson page.
 *
 * Whether somebody is signed in is read here, in the browser, rather than
 * passed down from the page: the lesson pages are prerendered, so a
 * server-rendered answer would be the answer at BUILD time — the same HTML
 * telling every reader they are signed out, which is wrong in a way that looks
 * authoritative.
 */
export function CommentSection({ subjectId }: { subjectId: string }) {
  const { data: session, isPending } = useSession();

  // While the session is unknown the list still renders — the comments are
  // public, and waiting for auth to show them would hide the discussion from
  // everybody for the length of a round trip. Only the controls that need an
  // identity wait.
  return (
    <CommentList
      subjectId={subjectId}
      signedIn={!isPending && Boolean(session?.user)}
      viewerId={session?.user?.id ?? null}
    />
  );
}
