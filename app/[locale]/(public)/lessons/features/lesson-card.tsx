import React from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { isRtl } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";

interface LessonCardProps {
  index: number;
  title: string;
  description: string;
  difficulty: "easy" | "medium" | "hard";
  category: string;
  slug: string;
}

const difficultyStyles: Record<string, string> = {
  easy: "bg-green-100 text-green-800",
  medium: "bg-amber-100 text-amber-800",
  hard: "bg-rose-100 text-rose-800",
};

/**
 * One lesson, as a full-width row.
 *
 * A row rather than a card in a four-column grid, and the reason is the
 * content and not the fashion: a lesson's useful summary is a sentence or two,
 * and a narrow card had to clamp it to three short lines — so the reader chose
 * between fourteen titles rather than between fourteen lessons. One column
 * gives the description the width to be read, and it is the same layout on a
 * phone as on a desktop, which means one set of behaviours to get right.
 *
 * The description is clamped at two lines here rather than three: at this
 * width two lines is more prose than three lines was in a card.
 */
const LessonCard: React.FC<LessonCardProps> = ({
  index,
  title,
  description,
  difficulty,
  category,
  slug,
}) => {
  const t = useTranslations("lessons");
  const locale = useLocale();
  // Directional affordance only — swapped, never CSS-flipped.
  const ArrowIcon = isRtl(locale) ? ArrowLeft : ArrowRight;

  return (
    <Link
      href={`/lessons/${slug}`}
      aria-label={`${t("readLesson")}: ${title}`}
      className="group relative flex items-start gap-4 border-b border-border px-1 py-6 no-underline transition-colors duration-150 hover:bg-muted/40 sm:gap-6 sm:px-2"
    >
      {/* The lesson number as a left rail. Hidden below `sm`, where the row is
          already narrow and the number is the least useful thing in it. */}
      {/*
        `text-muted-foreground`, not `/50` of it. Measured: at 50% opacity this
        was 2.47:1 against the dark background where axe wants 3:1 for 24px
        bold, and `tests/e2e/a11y-dark.spec.ts` failed on all six visible rows.
        Decorative text is still text — `aria-hidden` excuses it from the
        accessibility tree, not from being legible.
      */}
      <span
        aria-hidden
        className="hidden w-10 shrink-0 pt-0.5 font-serif text-2xl font-bold text-muted-foreground tabular-nums transition-colors duration-150 group-hover:text-primary-text sm:block"
      >
        {/* Padded to two digits so the rail is a column and not a ragged edge,
            and kept in Latin digits to match the "1.1", "1.2" section numbers
            used throughout the chemistry material. */}
        {String(index).padStart(2, "0")}
      </span>

      <div className="min-w-0 flex-1">
        {/* Eyebrow: the number for the readers who cannot see the rail, the
            category from the lesson data (untranslated), and the difficulty. */}
        <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[10.5px] font-bold uppercase tracking-widest text-primary-text sm:hidden">
            {t("lessonNumber", { number: String(index).padStart(2, "0") })}
          </span>
          <span className="text-[10.5px] font-bold uppercase tracking-widest text-primary-text">
            {category}
          </span>
          <span className="text-muted-foreground/40" aria-hidden>
            ·
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest whitespace-nowrap ${difficultyStyles[difficulty]}`}
          >
            {t(`difficulty.${difficulty}`)}
          </span>
        </div>

        {/* Title — lesson content, untranslated */}
        <h2 className="font-serif text-lg font-bold leading-snug text-card-foreground transition-colors duration-150 group-hover:text-primary-text sm:text-xl">
          {title}
        </h2>

        {/* Description — lesson content, untranslated */}
        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>

        <p className="mt-3 text-[11px] text-muted-foreground">
          {t("studyGuide")}
        </p>
      </div>

      <ArrowIcon
        aria-hidden
        className="mt-1 size-4 shrink-0 self-center text-primary-text opacity-0 transition-all duration-150 group-hover:opacity-100 ltr:group-hover:translate-x-1 rtl:group-hover:-translate-x-1"
      />
    </Link>
  );
};

export default LessonCard;
