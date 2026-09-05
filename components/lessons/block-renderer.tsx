import type { LessonBlock, RichText } from "@/lib/lessons/blocks";
import { isSafeHref, isAllowedMediaUrl } from "@/lib/lessons/blocks";
import { cn } from "@/lib/utils";

/**
 * Lesson blocks → markup.
 *
 * A server component with no `dangerouslySetInnerHTML` anywhere in the tree.
 * That is the point of the block model: there is no HTML to sanitise, because
 * no author-supplied string ever becomes markup — every value here lands in a
 * text node or an attribute this file chose.
 *
 * The URL checks run again at render even though the write path already
 * refused a bad one. Rows written before a schema change exist, a database can
 * be edited outside the application, and a validation that runs only on write
 * protects only the rows written after it.
 */

export function BlockRenderer({ blocks }: { blocks: readonly LessonBlock[] }) {
  return (
    <>
      {blocks.map((block) => (
        <Block key={block.id} block={block} />
      ))}
    </>
  );
}

function Block({ block }: { block: LessonBlock }) {
  switch (block.type) {
    case "paragraph":
      return (
        <p className="my-5 leading-8">
          <Inline runs={block.text} />
        </p>
      );

    case "heading":
      // The page's `<h1>` is the lesson title, so the body starts at 2 and
      // the schema admits no other level — a second `<h1>` would give the
      // document two top-level headings and break the outline.
      return block.level === 2 ? (
        <h2
          id={block.anchor}
          className="mt-10 scroll-mt-24 text-2xl font-bold tracking-tight"
        >
          {block.text}
        </h2>
      ) : (
        <h3
          id={block.anchor}
          className="mt-8 scroll-mt-24 text-xl font-semibold tracking-tight"
        >
          {block.text}
        </h3>
      );

    case "image":
      // Skipped, not rendered broken: a URL that fails the host check is
      // either a row predating the rule or one edited around it, and neither
      // is a reason to put an unknown origin in an `<img src>`.
      if (!isAllowedMediaUrl(block.url)) return null;
      return (
        <figure className="my-8">
          {/* eslint-disable-next-line @next/next/no-img-element -- the delivery
              host is configured per deployment, and next/image's loader is
              #27's to wire up along with the upload pipeline. */}
          <img
            src={block.url}
            alt={block.alt}
            width={block.width}
            height={block.height}
            loading="lazy"
            decoding="async"
            className="w-full rounded-lg border"
          />
          {block.caption && <Caption>{block.caption}</Caption>}
        </figure>
      );

    case "video":
      if (!isAllowedMediaUrl(block.url)) return null;
      return (
        <figure className="my-8">
          <video
            src={block.url}
            poster={
              block.posterUrl && isAllowedMediaUrl(block.posterUrl)
                ? block.posterUrl
                : undefined
            }
            controls
            preload="metadata"
            className="w-full rounded-lg border"
          />
          {block.caption && <Caption>{block.caption}</Caption>}
        </figure>
      );

    case "code":
      return (
        <pre className="my-6 overflow-x-auto rounded-lg border bg-muted p-4 text-sm">
          {/* The language is a class, never interpolated into markup. Syntax
              highlighting is the one path that would need HTML, and it is not
              built: unhighlighted code that is certainly safe beats coloured
              code that is probably safe. */}
          <code className={`language-${block.language}`} dir="ltr">
            {block.code}
          </code>
        </pre>
      );

    case "callout":
      return (
        <aside
          role="note"
          className={cn(
            "my-6 rounded-lg border-s-4 bg-secondary/50 p-4 text-sm",
            block.variant === "warning" && "border-s-amber-500",
            block.variant === "safety" && "border-s-destructive",
            block.variant === "note" && "border-s-primary",
          )}
        >
          <Inline runs={block.text} />
        </aside>
      );

    case "quote":
      return (
        <figure className="my-6">
          <blockquote className="border-s-4 ps-4 text-lg italic leading-8">
            <Inline runs={block.text} />
          </blockquote>
          {block.attribution && (
            <figcaption className="mt-2 text-sm text-muted-foreground">
              {block.attribution}
            </figcaption>
          )}
        </figure>
      );

    case "list": {
      const items = block.items.map((runs, index) => (
        // The index is the key because a list item has no id of its own; the
        // list is re-rendered whole when it changes, so there is nothing for a
        // stable key to preserve.
        <li key={index} className="leading-8">
          <Inline runs={runs} />
        </li>
      ));
      return block.ordered ? (
        <ol className="my-5 list-decimal space-y-1 ps-6">{items}</ol>
      ) : (
        <ul className="my-5 list-disc space-y-1 ps-6">{items}</ul>
      );
    }

    case "equation":
      return (
        // Left-to-right regardless of the page direction: chemical and
        // mathematical notation reads the same way in Arabic as in English,
        // and mirroring it would change what it says.
        <pre
          dir="ltr"
          className="my-6 overflow-x-auto rounded-lg border bg-muted p-4 text-center text-base"
        >
          {block.latex}
        </pre>
      );

    case "divider":
      return <hr className="my-10" />;
  }
}

/** Inline runs: marks and links, applied innermost-out. */
function Inline({ runs }: { runs: readonly RichText[] }) {
  return (
    <>
      {runs.map((run, index) => (
        <Run key={index} run={run} />
      ))}
    </>
  );
}

function Run({ run }: { run: RichText }) {
  let node: React.ReactNode = run.text;

  if (run.marks?.includes("code")) node = <code>{node}</code>;
  if (run.marks?.includes("underline")) node = <u>{node}</u>;
  if (run.marks?.includes("italic")) node = <em>{node}</em>;
  if (run.marks?.includes("bold")) node = <strong>{node}</strong>;

  if (run.href && isSafeHref(run.href)) {
    return (
      <a
        href={run.href}
        // Every author link is treated as external, because every one of them
        // may be: `noopener` denies the target `window.opener`, `nofollow`
        // stops the lesson from lending its ranking to whatever was pasted.
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="underline underline-offset-4"
      >
        {node}
      </a>
    );
  }

  return <>{node}</>;
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <figcaption className="mt-2 text-center text-sm text-muted-foreground">
      {children}
    </figcaption>
  );
}
