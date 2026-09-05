import { LINK_REL, segments } from "@/lib/comments/body";

/**
 * A comment body, rendered.
 *
 * Takes SEGMENTS rather than building an HTML string, so there is no markup
 * anywhere for an escaping mistake to live in: text goes in text nodes and
 * links go in `<a>` elements, and React escapes both. A body containing
 * `<script>` renders as the four-and-a-bit characters somebody typed.
 *
 * Not a client component: it has no state and no handlers, so it renders on
 * the server inside a client parent without shipping `linkify-it` twice.
 */
export function CommentText({ body }: { body: string }) {
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {segments(body).map((segment, index) =>
        segment.kind === "link" ? (
          <a
            key={index}
            href={segment.href}
            target="_blank"
            // `nofollow ugc` is the whole economics of comment spam: without
            // it a comment box is a way to buy PageRank from this site.
            rel={LINK_REL}
            className="text-primary underline underline-offset-2"
          >
            {segment.text}
          </a>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </p>
  );
}
