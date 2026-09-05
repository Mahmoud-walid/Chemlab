"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  BookOpen,
  BrainCircuit,
  FlaskConical,
  Gamepad2,
  HomeIcon,
  type LucideIcon,
} from "lucide-react";

// ─────────────────────────────────────────────
//  NAV CONFIG  ← only touch this to add pages
// ─────────────────────────────────────────────
interface NavItem {
  /** Key into the `nav` message namespace, not a display string. */
  labelKey: "home" | "lessons" | "quiz" | "experiments" | "games";
  href: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { labelKey: "home", href: "/", icon: HomeIcon },
  { labelKey: "lessons", href: "/lessons", icon: BookOpen },
  { labelKey: "quiz", href: "/quiz", icon: BrainCircuit },
  { labelKey: "experiments", href: "/experiments", icon: FlaskConical },
  { labelKey: "games", href: "/games", icon: Gamepad2 },
];

// ─────────────────────────────────────────────
//  SINGLE NAV ITEM
// ─────────────────────────────────────────────
function NavLink({
  item,
  isActive,
  label,
}: {
  item: NavItem;
  isActive: boolean;
  label: string;
}) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "relative flex flex-col items-center justify-center gap-1",
        "flex-1 min-w-0 py-2 px-1 rounded-xl",
        "transition-all duration-300 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "group",
      )}
    >
      {/* Active pill — bg-accent from your existing tokens */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-0 rounded-xl transition-all duration-300 ease-out bg-accent",
          isActive ? "scale-100 opacity-100" : "scale-75 opacity-0",
        )}
      />

      {/* Icon */}
      <Icon
        size={22}
        strokeWidth={isActive ? 2.2 : 1.8}
        className={cn(
          "relative z-10 transition-all duration-300 ease-out",
          isActive
            ? "text-primary-text scale-110 -translate-y-0.5"
            : "text-muted-foreground group-hover:text-foreground group-hover:scale-105",
        )}
      />

      {/* Label */}
      <span
        className={cn(
          "relative z-10 text-[11px] font-medium leading-none tracking-wide",
          "truncate max-w-full px-1 transition-all duration-300 ease-out",
          isActive
            ? "text-primary-text opacity-100 translate-y-0"
            : "text-muted-foreground translate-y-0.5 group-hover:text-foreground",
        )}
      >
        {label}
      </span>
    </Link>
  );
}

// ─────────────────────────────────────────────
//  FLOATING NAV BAR
// ─────────────────────────────────────────────
export function FloatingNavBar({
  /**
   * The route keys still open and flagged for the nav, resolved by the layout.
   *
   * Passed in rather than queried here: this is a client component, and a
   * closed page that is still linked is a link straight to a maintenance page.
   * Undefined means "no answer available" — every item renders, which matches
   * what the proxy does with no row.
   */
  openRoutes,
}: {
  openRoutes?: string[];
} = {}) {
  const pathname = usePathname();
  const open = openRoutes ? new Set(openRoutes) : null;
  const items = open
    ? NAV_ITEMS.filter((item) => open.has(item.href))
    : NAV_ITEMS;
  const t = useTranslations("nav");

  return (
    /* Outer positioner */
    <div className="fixed bottom-0 start-0 end-0 z-50 flex justify-center pointer-events-none px-4 pb-4 sm:pb-6">
      <nav
        aria-label={t("label")}
        className={cn(
          "pointer-events-auto",
          "w-full max-w-sm sm:max-w-md",
          "rounded-2xl border border-border",
          "bg-card/80 backdrop-blur-xl shadow-lg",
          "flex items-center px-2 py-1.5 gap-1",
        )}
      >
        {items.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            label={t(item.labelKey)}
            isActive={
              pathname === item.href || pathname.startsWith(item.href + "/")
            }
          />
        ))}
      </nav>
    </div>
  );
}

export default FloatingNavBar;
