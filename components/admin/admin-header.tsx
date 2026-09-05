"use client";

import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { useLocale } from "next-intl";

import { AccountMenu } from "@/components/customs/account-menu";
import {
  CommandPalette,
  type PaletteGroup,
} from "@/components/admin/command-palette";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Link, usePathname } from "@/i18n/navigation";
import { isRtl } from "@/i18n/routing";
import { breadcrumbsFor } from "@/lib/admin/nav";

/**
 * The admin header: sidebar toggle, breadcrumbs, a way back to the site, and
 * the account menu.
 *
 * Breadcrumbs are derived from the nav declaration rather than from raw URL
 * segments, so "roles" reads as its real label and a record id resolves to a
 * title when the page supplies one.
 */
export function AdminHeader({
  labels,
  crumbLabels,
  titles,
  palette,
}: {
  labels: { toggleSidebar: string; backToSite: string; breadcrumb: string };
  /** The same permission-filtered groups the sidebar renders. */
  palette: {
    groups: PaletteGroup[];
    labels: {
      open: string;
      placeholder: string;
      empty: string;
      title: string;
      description: string;
    };
  };
  /** Message key -> translated label, resolved on the server. */
  crumbLabels: Record<string, string>;
  /** Dynamic segment -> the record's title, supplied by the page. */
  titles?: Record<string, string>;
}) {
  const pathname = usePathname();
  const locale = useLocale();
  // The separator points along the reading direction, so it mirrors in Arabic
  // rather than pointing back the way the trail came.
  const Separator2 = isRtl(locale) ? ChevronLeft : ChevronRight;

  const crumbs = breadcrumbsFor(pathname, titles);

  return (
    <header
      role="banner"
      className="flex h-14 shrink-0 items-center gap-2 border-b px-3"
    >
      <SidebarTrigger aria-label={labels.toggleSidebar} />
      <Separator orientation="vertical" className="me-1 h-4" />

      <nav aria-label={labels.breadcrumb} className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-1.5 text-sm">
          {crumbs.map((crumb, index) => {
            const label = crumb.labelKey
              ? (crumbLabels[crumb.labelKey] ?? crumb.labelKey)
              : (crumb.label ?? "");

            return (
              <li
                key={crumb.href}
                className="flex min-w-0 items-center gap-1.5"
              >
                {index > 0 && (
                  <Separator2
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                )}
                {crumb.isCurrent ? (
                  // The current page is not a link to itself.
                  <span
                    aria-current="page"
                    className="truncate font-medium text-foreground"
                  >
                    {label}
                  </span>
                ) : (
                  <Link
                    href={crumb.href}
                    className="truncate text-muted-foreground hover:text-foreground"
                  >
                    {label}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <CommandPalette groups={palette.groups} labels={palette.labels} />

      <Button variant="ghost" size="sm" asChild>
        <Link href="/">
          <ExternalLink className="size-4" aria-hidden />
          <span className="hidden sm:inline">{labels.backToSite}</span>
        </Link>
      </Button>

      <AccountMenu />
    </header>
  );
}
