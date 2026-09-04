"use client";

import { useFormatter, useTranslations } from "next-intl";
import { type Element } from "@/types/element";
import { ElementCell, LATIN_DIGITS, categoryMessageKey } from "./element-cell";
import { getCategoryStyle, CATEGORY_LABELS } from "@/lib/element-utils";
import { cn } from "@/lib/utils";

interface PeriodicTableProps {
  elements: Element[];
}

export function PeriodicTable({ elements }: PeriodicTableProps) {
  const t = useTranslations("periodicTable");
  const tElement = useTranslations("element");
  const format = useFormatter();

  const mainElements = elements.filter(
    (e) =>
      !(e.number >= 57 && e.number <= 71) &&
      !(e.number >= 89 && e.number <= 103),
  );
  const lanthanides = elements.filter((e) => e.number >= 57 && e.number <= 71);
  const actinides = elements.filter((e) => e.number >= 89 && e.number <= 103);

  // 7 rows × 18 cols
  const grid: (Element | null)[][] = Array.from({ length: 7 }, () =>
    Array(18).fill(null),
  );
  for (const el of mainElements) {
    const row = el.ypos - 1;
    const col = el.xpos - 1;
    if (row >= 0 && row < 7 && col >= 0 && col < 18) grid[row][col] = el;
  }

  const uniqueCategories = [...new Set(elements.map((e) => e.category))].filter(
    (c) => CATEGORY_LABELS[c],
  );

  // Category strings come from JSON data, so the message key is only known at
  // runtime; next-intl types keys as a literal union, hence the narrow cast.
  const categoryLabel = (category: string) => {
    const key = `categories.${categoryMessageKey(category)}` as Parameters<
      typeof tElement
    >[0];
    return tElement.has(key) ? tElement(key) : category;
  };

  const range = (from: number, to: number) =>
    `${format.number(from, LATIN_DIGITS)}–${format.number(to, LATIN_DIGITS)}`;

  // Cell base sizes matching element-cell.tsx breakpoints
  // mobile: 28px, sm: 36px, md: 44px, lg: 52px
  // Gap: 2px everywhere
  // Total min width = 18 × 28 + 17 × 2 = 504 + 34 = 538px → needs scroll on small phones

  return (
    // Outer: full width, follows the page direction (the legend below reads RTL
    // on Arabic).
    <div className="w-full pb-1 -mx-1 px-1">
      {/*
        The periodic table itself is a scientific diagram, not prose: groups run
        1 → 18 left to right by worldwide convention, Arabic chemistry textbooks
        included. `dir="ltr"` is pinned here so the grid, the f-block rows and
        their horizontal scrolling stay canonical even inside `<html dir="rtl">`.
        Bidi still renders the Arabic labels inside it correctly.
      */}
      <div dir="ltr" className="w-full overflow-x-auto">
        {/* Inner: min-width ensures the table never collapses below readable size */}
        <div className="min-w-136 sm:min-w-0 w-full">
          {/* ── Main grid ── */}
          <div
            className="grid gap-0.5"
            role="group"
            aria-label={t("gridLabel")}
            style={{ gridTemplateColumns: "repeat(18, minmax(0, 1fr))" }}
          >
            {grid.map((row, rowIdx) =>
              row.map((el, colIdx) => {
                const key = `${rowIdx}-${colIdx}`;

                // Lanthanide / actinide placeholder
                if (!el && colIdx === 2 && (rowIdx === 5 || rowIdx === 6)) {
                  return (
                    <div
                      key={key}
                      className={cn(
                        "flex items-center justify-center rounded border border-dashed border-border",
                        "w-7 h-7 sm:w-9 sm:h-9 md:w-11 md:h-11 lg:w-13 lg:h-[3.25rem]",
                      )}
                    >
                      <span className="text-[5px] sm:text-[6px] text-muted-foreground leading-tight text-center">
                        {rowIdx === 5 ? range(57, 71) : range(89, 103)}
                      </span>
                    </div>
                  );
                }

                // Empty cell
                if (!el) {
                  return (
                    <div
                      key={key}
                      className="w-7 h-7 sm:w-9 sm:h-9 md:w-11 md:h-11 lg:w-[3.25rem] lg:h-[3.25rem]"
                    />
                  );
                }

                return <ElementCell key={el.number} element={el} />;
              }),
            )}
          </div>

          {/* ── Lanthanide / Actinide rows ── */}
          <div className="mt-1.5 flex flex-col gap-0.5">
            {[
              { key: "lanthanides", label: t("lanthanides"), row: lanthanides },
              { key: "actinides", label: t("actinides"), row: actinides },
            ].map(({ key, label, row }) => (
              <div key={key} className="flex items-center gap-1">
                {/*
                  Label width = ~3 cell widths to align under col 4.
                  Matches the 3 empty + placeholder slots on left.
                */}
                <div
                  className="shrink-0 text-end text-[8px] sm:text-[9px] text-muted-foreground leading-tight pe-0.5"
                  style={{ width: "calc(3 * (100% / 18 * 1) + 6px)" }}
                >
                  {label}
                </div>
                <div
                  className="grid gap-0.5 flex-1"
                  style={{ gridTemplateColumns: "repeat(15, minmax(0, 1fr))" }}
                >
                  {row.map((el) => (
                    <ElementCell key={el.number} element={el} compact />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Legend — prose chrome, so it flows with the page direction ── */}
      <ul
        aria-label={t("legendLabel")}
        className="mt-4 flex flex-wrap gap-1.5 sm:gap-2 list-none p-0"
      >
        {uniqueCategories.map((cat) => {
          const s = getCategoryStyle(cat);
          return (
            <li key={cat}>
              <span
                className={cn(
                  "inline-flex items-center px-2 py-0.5 rounded border",
                  "text-[9px] sm:text-[10px] md:text-xs font-medium",
                  s.bg,
                  s.text,
                  s.border,
                )}
              >
                {categoryLabel(cat)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
