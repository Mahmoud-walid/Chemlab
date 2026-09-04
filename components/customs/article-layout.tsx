import React from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { formatShortDate } from "@/lib/format-date";
import { isRtl } from "@/i18n/routing";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ArticleSection {
  id?: string;
  heading?: string;
  subheading?: string;
  content: React.ReactNode;
  /** Optional callout/note block inside this section */
  callout?: {
    type: "note" | "warning" | "tip" | "important";
    text: React.ReactNode;
  };
  image?: ArticleImage;
}

export interface ArticleImage {
  src: string;
  alt: string;
  caption?: string;
  width?: number | string;
  height?: number | string;
}

export interface ArticleVideo {
  src?: string;
  embedUrl?: string;
  title?: string;
  caption?: string;
}

export interface ArticleLink {
  label: string;
  href: string;
  description?: string;
}

export interface ArticleAuthor {
  name: string;
  role?: string;
  avatar?: string;
}

export interface ArticleLayoutProps {
  /** Page / lesson title */
  title: string;
  /** Short description shown below the title */
  description?: string;
  /** Author info */
  author?: ArticleAuthor;
  /** ISO date string or Date object */
  date?: string | Date;
  /** Topic tags */
  tags?: string[];
  /** Hero image (shown at the top of the article body) */
  heroImage?: ArticleImage;
  /** Main content sections */
  sections: ArticleSection[];
  /** Inline images scattered throughout (outside sections) */
  images?: ArticleImage[];
  /** Embedded or linked videos */
  videos?: ArticleVideo[];
  /** Further reading / reference links */
  links?: ArticleLink[];
  /** Optional table-of-contents label override (defaults to a translated label) */
  tocLabel?: string;
  /**
   * Notice rendered above the article body — used to flag content that has
   * not been translated into the active locale yet.
   */
  notice?: React.ReactNode;
  /**
   * Writing direction of the article body. Pass `"ltr"` when the prose is
   * English but the surrounding UI is right-to-left, so the source text keeps
   * its own punctuation and number ordering.
   */
  contentDir?: "ltr" | "rtl";
  /** Hide the table of contents */
  hideToc?: boolean;
  /** Optional className to pass to the root element */
  className?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type CalloutType = NonNullable<ArticleSection["callout"]>["type"];

const CALLOUT_META: Record<CalloutType, { icon: string; borderVar: string }> = {
  note: { icon: "ℹ", borderVar: "var(--chart-4)" },
  tip: { icon: "✦", borderVar: "var(--chart-5)" },
  warning: { icon: "⚠", borderVar: "var(--chart-3)" },
  important: { icon: "★", borderVar: "var(--primary)" },
};

function slugify(str: string) {
  return str
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]/g, "");
}

const ARTICLE_STYLES = `
  .article-toc-link {
    color: var(--foreground);
    border-radius: var(--radius-sm);
    display: block;
    padding-block: 0.375rem;
    padding-inline: 0.5rem;
    font-size: 0.875rem;
    text-align: start;
    transition: background 150ms, color 150ms;
    text-decoration: none;
  }
  .article-toc-link:hover {
    background: var(--accent);
    color: var(--accent-foreground);
  }
  .article-prose {
    text-align: start;
    line-height: 1.85;
  }
  /* Arabic script sits taller on the line than Latin at the same size,
     so the body copy needs extra leading to stay readable. */
  [dir="rtl"] .article-prose,
  .article-prose[dir="rtl"] {
    line-height: 2.1;
  }
`;

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionDivider() {
  return (
    <div className="mb-5 h-px w-16" style={{ background: "var(--primary)" }} />
  );
}

function ImageBlock({ image }: { image: ArticleImage }) {
  return (
    <figure className="my-8">
      <div
        className="overflow-hidden"
        style={{
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <img
          src={image.src}
          alt={image.alt}
          width={image.width}
          height={image.height}
          className="w-full object-cover"
        />
      </div>
      {image.caption && (
        <figcaption
          className="mt-2 text-center text-sm italic"
          style={{ color: "var(--muted-foreground)" }}
        >
          {image.caption}
        </figcaption>
      )}
    </figure>
  );
}

function VideoBlock({ video }: { video: ArticleVideo }) {
  const t = useTranslations("article");
  return (
    <figure className="my-8">
      <div
        className="overflow-hidden aspect-video"
        style={{
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-sm)",
          background: "var(--muted)",
        }}
      >
        {video.embedUrl ? (
          <iframe
            src={video.embedUrl}
            title={video.title ?? t("video")}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="w-full h-full"
          />
        ) : video.src ? (
          <video src={video.src} controls className="w-full h-full" />
        ) : null}
      </div>
      {video.caption && (
        <figcaption
          className="mt-2 text-center text-sm italic"
          style={{ color: "var(--muted-foreground)" }}
        >
          {video.caption}
        </figcaption>
      )}
    </figure>
  );
}

function CalloutBlock({
  callout,
}: {
  callout: NonNullable<ArticleSection["callout"]>;
}) {
  const t = useTranslations("article.callout");
  const { icon, borderVar } = CALLOUT_META[callout.type];
  return (
    <aside
      className="my-6 px-5 py-4"
      style={{
        // Logical properties so the accent bar sits on the reading-start edge
        // in both directions.
        borderInlineStart: `4px solid ${borderVar}`,
        background: "var(--secondary)",
        borderStartStartRadius: 0,
        borderEndStartRadius: 0,
        borderStartEndRadius: "var(--radius-md)",
        borderEndEndRadius: "var(--radius-md)",
      }}
    >
      <p
        className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest"
        style={{ color: "var(--secondary-foreground)" }}
      >
        <span aria-hidden>{icon}</span>
        {t(callout.type)}
      </p>
      <div
        className="text-sm leading-relaxed"
        style={{ color: "var(--foreground)" }}
      >
        {callout.text}
      </div>
    </aside>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ArticleLayout({
  title,
  description,
  author,
  date,
  tags,
  heroImage,
  sections,
  images,
  videos,
  links,
  tocLabel,
  notice,
  contentDir,
  hideToc = false,
  className = "",
}: ArticleLayoutProps) {
  const t = useTranslations("article");
  const locale = useLocale();
  // Directional affordance — swapped per locale rather than CSS-flipped, so
  // non-directional icons elsewhere are never mirrored by accident.
  // The arrow lives inside the article body, so it follows the body's own
  // direction rather than the page's.
  const bodyIsRtl = contentDir ? contentDir === "rtl" : isRtl(locale);
  const LinkArrow = bodyIsRtl ? ArrowLeft : ArrowRight;

  const tocItems = sections
    .filter((s) => s.heading)
    .map((s) => ({
      id: s.id ?? slugify(s.heading!),
      label: s.heading!,
    }));

  const formattedDate = date != null ? formatShortDate(date, { locale }) : null;

  return (
    <div
      className={`min-h-screen ${className}`}
      style={{ background: "var(--background)", color: "var(--foreground)" }}
    >
      {/* Scoped CSS — no JS event handlers needed */}
      <style>{ARTICLE_STYLES}</style>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header
        className="px-6 py-12 md:px-16 lg:px-24"
        style={{
          background: "var(--card)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="mx-auto max-w-4xl" dir={contentDir}>
          {/* Tags */}
          {tags && tags.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="px-3 py-0.5 text-xs font-medium uppercase tracking-wider"
                  style={{
                    borderRadius: "9999px",
                    background: "var(--accent)",
                    color: "var(--accent-foreground)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Title */}
          <h1
            className="mb-4 text-3xl font-bold leading-tight tracking-tight font-serif md:text-4xl lg:text-5xl"
            style={{ color: "var(--foreground)" }}
          >
            {title}
          </h1>

          {/* Description */}
          {description && (
            <p
              className="mb-6 text-lg leading-relaxed md:text-xl"
              style={{ color: "var(--muted-foreground)" }}
            >
              {description}
            </p>
          )}

          {/* Meta row */}
          <div
            className="flex flex-wrap items-center gap-4 text-sm"
            style={{ color: "var(--muted-foreground)" }}
          >
            {author && (
              <div className="flex items-center gap-2">
                {author.avatar ? (
                  <img
                    src={author.avatar}
                    alt={author.name}
                    className="h-8 w-8 rounded-full object-cover"
                    style={{ outline: "2px solid var(--border)" }}
                  />
                ) : (
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold"
                    style={{
                      background: "var(--secondary)",
                      color: "var(--secondary-foreground)",
                    }}
                  >
                    {author.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <div>
                  <span
                    className="font-medium"
                    style={{ color: "var(--foreground)" }}
                  >
                    {author.name}
                  </span>
                  {author.role && (
                    <span
                      className="ms-1"
                      style={{ color: "var(--muted-foreground)" }}
                    >
                      · {author.role}
                    </span>
                  )}
                </div>
              </div>
            )}
            {formattedDate && (
              <>
                {author && (
                  <span style={{ color: "var(--border)" }} aria-hidden>
                    ·
                  </span>
                )}
                <time>{formattedDate}</time>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-7xl px-6 py-10 md:px-16 lg:px-24">
        <div className="flex flex-col gap-12 lg:flex-row lg:gap-16">
          {/* ── Main content ─────────────────────────────────────────────── */}
          <main className="min-w-0 flex-1" dir={contentDir}>
            {notice}
            {heroImage && <ImageBlock image={heroImage} />}

            {sections.map((section, idx) => {
              const id =
                section.id ?? slugify(section.heading ?? `section-${idx}`);
              return (
                <section key={id} id={id} className="mb-12 scroll-mt-20">
                  {section.heading && (
                    <h2
                      className="mb-2 text-2xl font-bold font-serif md:text-3xl"
                      style={{ color: "var(--foreground)" }}
                    >
                      {section.heading}
                    </h2>
                  )}
                  {section.subheading && (
                    <h3
                      className="mb-3 text-base font-semibold uppercase tracking-widest"
                      style={{ color: "var(--primary)" }}
                    >
                      {section.subheading}
                    </h3>
                  )}
                  {section.heading && <SectionDivider />}

                  <div
                    className="article-prose prose max-w-none text-base"
                    style={{ color: "var(--foreground)" }}
                  >
                    {section.content}
                  </div>

                  {section.callout && (
                    <CalloutBlock callout={section.callout} />
                  )}
                  {section.image && <ImageBlock image={section.image} />}
                </section>
              );
            })}

            {/* Extra figures */}
            {images && images.length > 0 && (
              <section className="mb-12">
                <h2
                  className="mb-2 text-2xl font-bold font-serif"
                  style={{ color: "var(--foreground)" }}
                >
                  {t("figures")}
                </h2>
                <SectionDivider />
                <div className="grid gap-6 sm:grid-cols-2">
                  {images.map((img, i) => (
                    <ImageBlock key={i} image={img} />
                  ))}
                </div>
              </section>
            )}

            {/* Videos */}
            {videos && videos.length > 0 && (
              <section className="mb-12">
                <h2
                  className="mb-2 text-2xl font-bold font-serif"
                  style={{ color: "var(--foreground)" }}
                >
                  {t("videos")}
                </h2>
                <SectionDivider />
                {videos.map((v, i) => (
                  <VideoBlock key={i} video={v} />
                ))}
              </section>
            )}

            {/* Further reading */}
            {links && links.length > 0 && (
              <section className="mb-12">
                <h2
                  className="mb-2 text-2xl font-bold font-serif"
                  style={{ color: "var(--foreground)" }}
                >
                  {t("furtherReading")}
                </h2>
                <SectionDivider />
                <ul className="space-y-3">
                  {links.map((link, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <LinkArrow
                        aria-hidden
                        className="mt-1 size-4 shrink-0"
                        style={{ color: "var(--primary)" }}
                      />
                      <div>
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium underline underline-offset-2 transition-opacity hover:opacity-70"
                          style={{ color: "var(--primary)" }}
                        >
                          {link.label}
                        </a>
                        {link.description && (
                          <p
                            className="mt-0.5 text-sm"
                            style={{ color: "var(--muted-foreground)" }}
                          >
                            {link.description}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </main>

          {/* ── Sidebar TOC ───────────────────────────────────────────────── */}
          {!hideToc && tocItems.length > 0 && (
            <aside className="hidden lg:block lg:w-60 xl:w-72">
              <div
                className="sticky top-8 p-6"
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-lg)",
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <p
                  className="mb-4 text-xs font-semibold uppercase tracking-widest"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  {tocLabel ?? t("onThisPage")}
                </p>
                <nav>
                  <ul className="space-y-1">
                    {tocItems.map((item) => (
                      <li key={item.id}>
                        <a href={`#${item.id}`} className="article-toc-link">
                          {item.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </nav>
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
