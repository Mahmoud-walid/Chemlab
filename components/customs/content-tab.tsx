"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { direction } from "@/i18n/routing";

export interface ContentTabAction {
  label: string;
  onClick: () => void;
}

export interface ContentTabItem {
  name: string;
  value: string;
  content: React.ReactNode;
  actions?: ContentTabAction[];
}

interface ContentTabProps {
  tabs: ContentTabItem[];
  defaultValue?: string;
  orientation?: "vertical" | "horizontal";
  className?: string;
}

export const ContentTab = ({
  tabs,
  defaultValue,
  orientation = "vertical",
  className,
}: ContentTabProps) => {
  const t = useTranslations("contentTab");
  const locale = useLocale();
  const dir = direction(locale);
  const [active, setActive] = useState(defaultValue ?? tabs[0]?.value);

  const activeTab = tabs.find((t) => t.value === active);

  const renderTabButton = (
    tab: ContentTabItem,
    variant: "vertical" | "horizontal",
  ) => {
    const isActive = active === tab.value;

    const btnClass =
      variant === "vertical"
        ? cn(
            "text-start px-3 py-2 rounded-md text-sm transition-colors w-full cursor-pointer",
            "text-muted-foreground hover:text-foreground hover:bg-muted/60",
            isActive && "bg-muted text-foreground font-medium",
          )
        : cn(
            "shrink-0 px-4 py-2.5 text-sm font-medium transition-colors relative cursor-pointer",
            "text-muted-foreground hover:text-foreground",
            isActive &&
              "text-foreground after:absolute after:bottom-0 after:inset-x-0 after:h-0.5 after:bg-foreground",
          );

    if (tab.actions?.length) {
      return (
        <DropdownMenu key={`${variant}-${tab.value}`} dir={dir}>
          <DropdownMenuTrigger asChild>
            <button className={btnClass}>{tab.name}</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => setActive(tab.value)}>
              {t("viewContent")}
            </DropdownMenuItem>
            {tab.actions.map((action) => (
              <DropdownMenuItem key={action.label} onClick={action.onClick}>
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    return (
      <button
        key={`${variant}-${tab.value}`}
        onClick={() => setActive(tab.value)}
        className={btnClass}
      >
        {tab.name}
      </button>
    );
  };

  // always horizontal — no responsive switching needed
  if (orientation === "horizontal") {
    return (
      <div className={cn("w-full", className)}>
        <ScrollArea dir={dir} className="w-full">
          <div className="flex gap-1 border-b border-border">
            {tabs.map((tab) => renderTabButton(tab, "horizontal"))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
        <div className="mt-6 text-sm text-muted-foreground leading-relaxed">
          {activeTab?.content}
        </div>
      </div>
    );
  }

  // orientation="vertical" with CSS-only responsive behavior:
  // - No JS / no useEffect / no isMobile state
  // - Content is always in the DOM (SEO safe)
  // - Tailwind md: breakpoint switches layout purely via CSS
  return (
    <div className={cn("w-full", className)}>
      {/*
        Outer wrapper:
        - mobile: flex-col (tab bar on top, content below)
        - desktop: flex-row, which follows the writing direction: the tab
          sidebar sits on the left in LTR and on the right in RTL, with the
          content on the opposite side. No physical offsets are used, so the
          whole layout mirrors on its own under `dir="rtl"`.
      */}
      <div className="flex flex-col md:flex-row md:gap-8">
        {/*
          Tab nav:
          - mobile: horizontal scrollable bar
          - desktop: vertical sidebar column
        */}
        <div className="md:w-50 md:min-w-50 md:shrink-0">
          {/* Mobile horizontal bar */}
          <div className="md:hidden">
            <ScrollArea dir={dir} className="w-full">
              <div className="flex gap-1 border-b border-border">
                {tabs.map((tab) => renderTabButton(tab, "horizontal"))}
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </div>

          {/* Desktop vertical sidebar */}
          <div className="hidden md:flex flex-col gap-0.5">
            {tabs.map((tab) => renderTabButton(tab, "vertical"))}
          </div>
        </div>

        {/* Divider — desktop only */}
        <div className="hidden md:block w-px bg-border shrink-0" />

        {/* Content — always in DOM, SEO safe */}
        <div className="flex-1 min-w-0 mt-6 md:mt-0 text-sm text-muted-foreground leading-relaxed">
          {activeTab?.content}
        </div>
      </div>
    </div>
  );
};
