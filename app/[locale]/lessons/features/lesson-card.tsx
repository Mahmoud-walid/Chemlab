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
      className="group relative flex flex-col bg-card text-card-foreground border border-border rounded-xl p-6 overflow-hidden transition-all duration-200 hover:-translate-y-1 hover:shadow-lg hover:border-primary/30 no-underline"
    >
      {/* Top accent bar */}
      <span className="absolute top-0 inset-x-0 h-0.75 bg-primary opacity-0 group-hover:opacity-100 transition-opacity duration-200 rounded-t-xl" />

      {/* Card header row */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <span className="text-[11px] font-bold tracking-widest uppercase text-primary bg-secondary px-2.5 py-1 rounded-full whitespace-nowrap">
          {/* The index is passed as a pre-padded string so the lesson numbering
              stays in Latin digits, matching the "1.1", "1.2" section numbers
              used throughout the chemistry material. */}
          {t("lessonNumber", { number: String(index).padStart(2, "0") })}
        </span>
        <span
          className={`text-[10px] font-bold tracking-widest uppercase px-2.5 py-1 rounded-full whitespace-nowrap ${difficultyStyles[difficulty]}`}
        >
          {t(`difficulty.${difficulty}`)}
        </span>
      </div>

      {/* Category eyebrow — comes from the lesson data, untranslated */}
      <p className="text-[10.5px] font-bold tracking-widest uppercase text-primary mb-1.5">
        {category}
      </p>

      {/* Title — lesson content, untranslated */}
      <h3 className="font-serif text-base font-bold leading-snug text-card-foreground mb-2">
        {title}
      </h3>

      {/* Description — lesson content, untranslated */}
      <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3 flex-1">
        {description}
      </p>

      {/* Footer */}
      <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          {t("studyGuide")}
        </span>
        <ArrowIcon
          aria-hidden
          className="size-4 text-primary transition-transform duration-200 ltr:group-hover:translate-x-1 rtl:group-hover:-translate-x-1"
        />
      </div>
    </Link>
  );
};

export default LessonCard;
