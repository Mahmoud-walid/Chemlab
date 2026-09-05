"use client";

import { useEffect, useState } from "react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { hrefFor } from "@/lib/admin/nav";
import { useHydrated } from "@/hooks/use-hydrated";

export interface PaletteGroup {
  label: string;
  items: { segment: string; label: string }[];
}

/**
 * ⌘K / Ctrl+K navigation for the admin panel.
 *
 * Fed by the SAME filtered groups the sidebar renders, which the layout has
 * already narrowed to what the viewer may see. That is the point of passing
 * them in rather than reading `ADMIN_NAV` here: a palette built from the raw
 * declaration would happily offer an editor a jump to Settings, and the guard
 * would then 404 them — an invitation followed by a refusal.
 *
 * The filtering is still only cosmetic. Every destination re-checks for itself,
 * as it does for the sidebar.
 */
export function CommandPalette({
  groups,
  labels,
}: {
  groups: PaletteGroup[];
  labels: {
    open: string;
    placeholder: string;
    empty: string;
    title: string;
    description: string;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // The shortcut hint differs by platform, and reading `navigator` during
  // render would make the server and client markup disagree.
  const hydrated = useHydrated();
  const isMac =
    hydrated &&
    typeof navigator !== "undefined" &&
    /mac/i.test(navigator.platform || navigator.userAgent);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k") return;
      // Either modifier, so the shortcut works on a Mac and on everything else
      // without the page having to know which it is.
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      setOpen((current) => !current);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const go = (segment: string) => {
    setOpen(false);
    router.push(hrefFor(segment));
  };

  return (
    <>
      {/* A visible trigger as well as the shortcut: a keyboard shortcut nobody
          is told about is a feature only its author uses, and it is the only
          way in for anyone on a touch device. */}
      <Button
        variant="outline"
        size="sm"
        className="gap-2 text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <span className="hidden sm:inline">{labels.open}</span>
        <Kbd>{isMac ? "⌘" : "Ctrl"} K</Kbd>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title={labels.title}
        description={labels.description}
      >
        <CommandInput placeholder={labels.placeholder} />
        <CommandList>
          <CommandEmpty>{labels.empty}</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup key={group.label} heading={group.label}>
              {group.items.map((item) => (
                <CommandItem
                  key={item.segment}
                  // cmdk filters on this, not on the rendered children, so a
                  // search for "less" has to match the label rather than the
                  // React node.
                  value={`${item.label} ${hrefFor(item.segment)}`}
                  onSelect={() => go(item.segment)}
                >
                  {item.label}
                  <span className="ms-auto text-xs text-muted-foreground">
                    {hrefFor(item.segment)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
