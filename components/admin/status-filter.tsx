"use client";

import { useSearchParams } from "next/navigation";

import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * The status filter, as links rather than a select.
 *
 * Links because the filter belongs in the URL like the rest of the list state:
 * "the drafts" is a view someone sends to a colleague. A select would need
 * JavaScript to navigate and would leave nothing to copy.
 */
export function StatusFilter({
  current,
  options,
  label,
  param = "status",
}: {
  current: string;
  options: { value: string; label: string }[];
  label: string;
  /**
   * Which query parameter this row of links controls. Defaults to `status`,
   * which is what it was built for; a list can carry a second row over a
   * different parameter — the translation state, say — without a second
   * component that would drift from this one's URL handling.
   */
  param?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const hrefFor = (value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value === "all") next.delete(param);
    else next.set(param, value);
    // Back to the first page: staying on page 3 of a narrowed result is how a
    // filter appears to return nothing.
    next.delete("page");
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  };

  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-1">
      {options.map((option) => {
        const isCurrent = option.value === current;
        return (
          <Link
            key={option.value}
            href={hrefFor(option.value)}
            aria-current={isCurrent ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              isCurrent
                ? "bg-secondary font-medium text-secondary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}
