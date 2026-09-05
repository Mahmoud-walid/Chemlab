/**
 * The shapes the comment UI passes around.
 *
 * Separate from the query layer's own types so a client component can import
 * them without pulling Drizzle into the browser bundle.
 */

export type CommentReaction = "like" | "dislike" | null;

export interface CommentView {
  id: string;
  parentId: string | null;
  depth: number;
  body: string;
  authorId: string | null;
  authorName: string | null;
  authorImage: string | null;
  likeCount: number;
  dislikeCount: number;
  replyCount: number;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  viewerReaction: CommentReaction;
  /** The first few replies, sent with the root so a thread renders in one
   * round trip. The rest page separately. */
  replies?: CommentView[];
}

export interface CommentPageResponse {
  items: CommentView[];
  nextCursor: string | null;
}
