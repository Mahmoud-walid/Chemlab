"use client";

import { LayoutDashboard } from "lucide-react";
import { useMemo } from "react";

import { Link, usePathname } from "@/i18n/navigation";
import { ADMIN_NAV, flattenNav, hrefFor } from "@/lib/admin/nav";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";

export interface AdminNavGroupView {
  label: string;
  items: { segment: string; label: string }[];
}

/**
 * The admin sidebar.
 *
 * Receives already-filtered groups with already-translated labels: the server
 * decides what this viewer may see, and a client component cannot be trusted
 * with that decision. Icons are resolved here by segment, because a Lucide
 * component cannot cross the server/client boundary as a prop.
 *
 * Spacing and direction use logical properties throughout (`ms`/`me`,
 * `start`/`end`), so the whole shell mirrors under `dir="rtl"` — rail on the
 * right, chevrons flipped — rather than being an English layout with Arabic
 * words in it.
 */
export function AdminSidebar({
  groups,
  labels,
}: {
  groups: AdminNavGroupView[];
  labels: { nav: string; title: string };
}) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();

  const iconFor = useMemo(() => {
    const icons = new Map(
      flattenNav(ADMIN_NAV).map((item) => [item.segment, item.icon]),
    );
    return (segment: string) => icons.get(segment) ?? LayoutDashboard;
  }, []);

  /**
   * The dashboard lives at `/admin`, so a plain `startsWith` would mark it
   * active on every admin page. It matches exactly; everything else matches
   * its subtree, so a lesson's edit page keeps "Lessons" highlighted.
   */
  const isActive = (segment: string) => {
    const href = hrefFor(segment);
    if (segment === "") return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <span className="truncate text-sm font-semibold">{labels.title}</span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {/* One landmark for the whole panel, named, so a screen reader
            announces "Admin navigation" rather than an anonymous list. */}
        <nav aria-label={labels.nav}>
          {groups.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => {
                    const Icon = iconFor(item.segment);
                    const active = isActive(item.segment);
                    return (
                      <SidebarMenuItem key={item.segment || "dashboard"}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          // The collapsed rail shows icons only, so the
                          // accessible name has to come from somewhere.
                          tooltip={item.label}
                        >
                          <Link
                            href={hrefFor(item.segment)}
                            aria-current={active ? "page" : undefined}
                            // Closing on navigate is what makes the drawer
                            // usable: otherwise it covers the page you just
                            // asked for.
                            onClick={() => isMobile && setOpenMobile(false)}
                          >
                            <Icon aria-hidden />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </nav>
      </SidebarContent>

      <SidebarFooter />
      <SidebarRail />
    </Sidebar>
  );
}
