"use client";

import { Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The search box over a catalogue that is already in the browser.
 *
 * Controlled, with no debounce and no timer anywhere — the filtering it drives
 * is a synchronous pass over an array that is already in memory, so there is
 * nothing to delay. A debounce here would be a deliberate lag between typing
 * and seeing, added to protect a request that is never made.
 *
 * Four details are the difference between this and an input with a magnifier
 * next to it:
 *
 * - **The result count is announced.** A sighted reader sees the list shrink;
 *   without `aria-live` a screen-reader user types into a box and is told
 *   nothing at all.
 * - **Escape clears it**, which is what the native `type="search"` contract
 *   promises and what readers try first.
 * - **The clear button is absent when the box is empty.** A control that
 *   cannot do anything should not be there to be pressed.
 * - **`type="search"` with the WebKit cancel button hidden.** Keeping the
 *   semantics, dropping the second X that would otherwise sit next to ours in
 *   Safari and Chrome.
 */
export function CatalogueSearch({
  id,
  value,
  onChange,
  label,
  placeholder,
  clearLabel,
  resultSummary,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  clearLabel: string;
  /** Already-formatted count of what is showing, e.g. "3 lessons". */
  resultSummary: string;
}) {
  return (
    <div className="w-full">
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-muted-foreground start-3"
        />
        <Input
          id={id}
          type="search"
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          // Chemistry names are not dictionary words and the catalogue is
          // bilingual; a phone correcting "alkane" to "alkaline" searches for
          // something the reader did not ask for.
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onChange("");
          }}
          className="h-11 ps-9 pe-9 [&::-webkit-search-cancel-button]:hidden"
        />
        {value !== "" && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label={clearLabel}
            className="absolute top-1/2 end-2 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X aria-hidden className="size-4" />
          </button>
        )}
      </div>
      {/*
        `polite` and always present. Rendering the region only once there is
        something to say means the assistive technology meets a brand-new node
        and may not announce it at all; an empty live region that fills is the
        shape that works.
      */}
      <p aria-live="polite" className="sr-only">
        {resultSummary}
      </p>
    </div>
  );
}
