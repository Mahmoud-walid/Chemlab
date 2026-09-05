"use client";

import { SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isLocked, type ColumnSpec } from "@/lib/admin/column-visibility";

/**
 * Which columns to show.
 *
 * Locked columns are listed and disabled rather than omitted. Omitting them
 * would leave somebody hunting for "Title" in a menu that never had it; a
 * ticked, unclickable row says "this one stays" without needing a sentence.
 */
export function ColumnMenu({
  columns,
  hidden,
  onToggle,
  labels,
}: {
  columns: (ColumnSpec & { header: string })[];
  hidden: Set<string>;
  onToggle: (column: ColumnSpec) => void;
  labels: { columns: string; columnsHint: string };
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <SlidersHorizontal aria-hidden className="size-4" />
          {labels.columns}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {labels.columnsHint}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={!hidden.has(column.id)}
            disabled={isLocked(column)}
            // The menu stays open: hiding three columns should be three
            // clicks, not three round trips through a closing menu.
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={() => onToggle(column)}
          >
            {column.header}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
