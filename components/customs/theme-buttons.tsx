"use client";

import { useTheme } from "next-themes";
import { useId } from "react";
import { MoonIcon, SunIcon, MonitorIcon } from "lucide-react";

import { useHydrated } from "@/hooks/use-hydrated";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ThemeOption {
  value: string;
  label: string;
  icon: React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
  tooltip: string;
}

const themeOptions: ThemeOption[] = [
  {
    value: "light",
    label: "Light",
    icon: SunIcon,
    tooltip: "Switch to light mode",
  },
  {
    value: "dark",
    label: "Dark",
    icon: MoonIcon,
    tooltip: "Switch to dark mode",
  },
  {
    value: "system",
    label: "System",
    icon: MonitorIcon,
    tooltip: "Use system preference",
  },
];

export function ThemeButtons() {
  const { theme, setTheme } = useTheme();
  const id = useId();
  // Prevent hydration mismatch: `theme` is only known on the client.
  const mounted = useHydrated();

  if (!mounted) {
    return null;
  }

  return (
    <TooltipProvider>
      <RadioGroup
        value={theme}
        onValueChange={setTheme}
        className="flex items-center gap-1"
        aria-label="Theme selection"
      >
        {themeOptions.map((option) => {
          const Icon = option.icon;
          const itemId = `${id}-${option.value}`;

          return (
            <Tooltip key={option.value}>
              <TooltipTrigger asChild>
                <div className="flex items-center">
                  <RadioGroupItem
                    value={option.value}
                    id={itemId}
                    className="peer sr-only"
                  />
                  <Label
                    htmlFor={itemId}
                    className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:bg-accent peer-data-[state=checked]:text-accent-foreground transition-colors"
                  >
                    <Icon size={14} aria-hidden />
                    <span className="sr-only">{option.label}</span>
                  </Label>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{option.tooltip}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </RadioGroup>
    </TooltipProvider>
  );
}
