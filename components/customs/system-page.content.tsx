"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useStoredValue } from "@/hooks/use-stored-value";
import { writeStoredValue } from "@/lib/browser-storage";
import { Type, Palette, Settings, Languages } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ThemeButtons } from "@/components/customs/theme-buttons";
import { LocaleSwitcher } from "@/components/customs/locale-switcher";
import { cn } from "@/lib/utils";

const FONT_KEY = "user-font";
const DEFAULT_FONT = "roboto";
// Font names are proper nouns — they stay untranslated in every locale.
const FONTS = [
  { id: "bebasNeue", name: "Bebas Neue", variable: "var(--font-bebas-neue)" },
  { id: "geist", name: "Geist Sans", variable: "var(--font-geist-sans)" },
  { id: "inter", name: "Inter", variable: "var(--font-inter)" },
  { id: "roboto", name: "Roboto", variable: "var(--font-roboto)" },
  { id: "poppins", name: "Poppins", variable: "var(--font-poppins)" },
  { id: "montserrat", name: "Montserrat", variable: "var(--font-montserrat)" },
  { id: "openSans", name: "Open Sans", variable: "var(--font-open-sans)" },
  { id: "lato", name: "Lato", variable: "var(--font-lato)" },
  { id: "raleway", name: "Raleway", variable: "var(--font-raleway)" },
  {
    id: "playfair",
    name: "Playfair Display",
    variable: "var(--font-playfair)",
  },
  { id: "geistMono", name: "Geist Mono", variable: "var(--font-geist-mono)" },
  { id: "kodeMono", name: "Kode Mono", variable: "var(--font-kode-mono)" },
];

type Props = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
};

export default function SystemPageContent({
  open: controlledOpen,
  onOpenChange,
  defaultOpen = true,
}: Props) {
  const t = useTranslations("settings");
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const font = useStoredValue("local", FONT_KEY, DEFAULT_FONT) ?? DEFAULT_FONT;

  const open = controlledOpen ?? internalOpen;

  function handleOpenChange(next: boolean) {
    if (onOpenChange) onOpenChange(next);
    else setInternalOpen(next);
  }

  // Apply the selected font to the document (an external system).
  useEffect(() => {
    const selected = FONTS.find((f) => f.id === font);
    if (selected) {
      document.body.style.setProperty("--active-font", selected.variable);
    }
  }, [font]);

  const handleFontChange = (fontId: string) => {
    writeStoredValue("local", FONT_KEY, fontId);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-full max-w-lg mx-auto rounded-2xl p-0 shadow-2xl overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border">
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <Settings className="w-4 h-4 text-primary" />
            {t("title")}
          </DialogTitle>
          <DialogDescription className="text-start">
            {t("description")}
          </DialogDescription>
        </DialogHeader>

        {/* Body */}
        <div className="px-6 py-5 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* Theme */}
          <Section
            icon={<Palette className="w-4 h-4" />}
            label={t("theme.section")}
          >
            <ThemeButtons />
          </Section>

          <Divider />

          {/* Language */}
          <Section
            icon={<Languages className="w-4 h-4" />}
            label={t("language")}
          >
            <LocaleSwitcher />
          </Section>

          <Divider />

          {/* Font */}
          <Section icon={<Type className="w-4 h-4" />} label={t("font")}>
            <div className="grid grid-cols-2 gap-2">
              {FONTS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => handleFontChange(f.id)}
                  aria-pressed={font === f.id}
                  className={cn(
                    "flex flex-col items-start px-3 py-2.5 rounded-lg border text-start transition-all",
                    font === f.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:border-primary/50 hover:bg-muted",
                  )}
                >
                  <span
                    className="text-lg leading-none mb-1"
                    style={{ fontFamily: f.variable }}
                    lang="en"
                    dir="ltr"
                  >
                    {t("fontSample")}
                  </span>
                  <span
                    className="text-xs text-muted-foreground truncate w-full"
                    lang="en"
                    dir="ltr"
                  >
                    {f.name}
                  </span>
                </button>
              ))}
            </div>
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-widest">
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="border-t border-border" />;
}
