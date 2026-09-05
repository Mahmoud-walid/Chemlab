"use client";

import { Download } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The download control, as a plain anchor.
 *
 * Not a button with a fetch behind it. An anchor to a GET hands the transfer
 * to the browser: it streams to disk rather than into a Blob in memory, the
 * progress and cancel controls are the ones the user already knows, and it
 * works with JavaScript disabled. A fetch would have to hold the whole file in
 * the tab before writing it — which is exactly the failure the streaming route
 * exists to avoid, re-introduced on the client.
 *
 * `carryFilters` copies the CURRENT query string into the download URL, so the
 * file matches the table above it. An export that silently returned everything
 * while the screen showed one filtered week would be the worst kind of wrong:
 * plausible, and impossible to notice from the file.
 *
 * Not `next/link`: this navigates to a route handler that answers with an
 * attachment, and the client router would try to treat the response as a page.
 */
export function ExportButton({
  dataset,
  label,
  hint,
  params,
  carryFilters = false,
}: {
  dataset: string;
  label: string;
  /** Announced with the link — what the file will contain, said once. */
  hint?: string;
  /** Fixed parameters, such as the quiz a page is about. */
  params?: Record<string, string>;
  carryFilters?: boolean;
}) {
  const searchParams = useSearchParams();

  const query = new URLSearchParams(
    carryFilters ? searchParams.toString() : "",
  );
  // Paging belongs to the screen, never to the file: a spreadsheet of page 2
  // of 40 is not an export of anything.
  query.delete("page");
  query.delete("pageSize");
  query.set("dataset", dataset);
  for (const [key, value] of Object.entries(params ?? {})) {
    query.set(key, value);
  }

  return (
    <a
      href={`/api/admin/export?${query.toString()}`}
      // Tells the browser this is a download rather than a navigation, so a
      // failed request does not replace the admin screen with plain text.
      download
      rel="nofollow"
      title={hint}
      className={cn(
        buttonVariants({ variant: "outline", size: "sm" }),
        "gap-2",
      )}
    >
      <Download aria-hidden="true" className="size-4" />
      {label}
    </a>
  );
}
