"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { type Element } from "@/types/element";
import { getCategoryStyle } from "@/lib/element-utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Latin (Western Arabic) digits everywhere, including on the Arabic locale.
 * A page that mixes `H₂O`, `1.008` and equation coefficients reads badly with
 * Eastern Arabic numerals, so the numbering system is pinned rather than left
 * to the locale default (`ar` would otherwise resolve to `arab`).
 */
export const LATIN_DIGITS = { numberingSystem: "latn" } as const;

/**
 * Turns a raw category string from `data/periodic-table-detailed.json`
 * ("post-transition metal") into the message key used under
 * `element.categories.*` ("postTransitionMetal").
 */
export function categoryMessageKey(category: string): string {
  const words = category
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return words
    .map((word, i) => (i === 0 ? word : word[0].toUpperCase() + word.slice(1)))
    .join("");
}

interface ElementCellProps {
  element: Element;
  compact?: boolean;
}

export function ElementCell({ element, compact = false }: ElementCellProps) {
  const t = useTranslations("element");
  const format = useFormatter();
  const style = getCategoryStyle(element.category);
  const slug = element.name.toLowerCase();

  // The category comes from JSON data, so the message key is only known at
  // runtime; next-intl types keys as a literal union, hence the narrow cast.
  const categoryKey = `categories.${categoryMessageKey(
    element.category,
  )}` as Parameters<typeof t>[0];
  const categoryLabel = t.has(categoryKey) ? t(categoryKey) : element.category;

  const atomicNumber = format.number(element.number, LATIN_DIGITS);
  const atomicMass = t("units.atomicMass", {
    value: format.number(element.atomic_mass, {
      ...LATIN_DIGITS,
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }),
  });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={`/chemical/${slug}`}
          className={cn(
            "group relative flex flex-col items-center justify-center",
            "rounded-lg border transition-all duration-200 ease-out",
            "cursor-pointer select-none overflow-hidden min-w-0",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "w-full aspect-square",
            style.bg,
            style.border,
            "hover:scale-110 hover:z-10 hover:shadow-md hover:brightness-105",
          )}
          aria-label={`${element.name} (${element.symbol})`}
        >
          {/* Atomic number */}
          <span className="leading-none font-mono tabular-nums text-muted-foreground text-[clamp(6px,1.1cqi,9px)]">
            {atomicNumber}
          </span>

          {/* Symbol — locale-invariant */}
          <span
            className={cn(
              "font-bold leading-none text-[clamp(9px,2cqi,16px)]",
              style.text,
            )}
          >
            {element.symbol}
          </span>

          {/* Name — element names stay in the source language (out of scope) */}
          <span className="leading-none text-center truncate w-full px-0.5 text-muted-foreground text-[clamp(6px,0.9cqi,8px)]">
            {element.name}
          </span>
        </Link>
      </TooltipTrigger>

      <TooltipContent side="top" className="text-center bg-primary">
        <p className="font-semibold text-sm">{element.name}</p>
        {/* Number + mass is a numeric run: keep it LTR under `dir=rtl`. */}
        <p className="text-xs" dir="ltr">
          {atomicNumber} · {atomicMass}
        </p>
        <p className="text-xs">{categoryLabel}</p>
      </TooltipContent>
    </Tooltip>
  );
}
