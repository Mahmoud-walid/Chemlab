"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import elements from "@/data/periodic-table-detailed.json";
import { type Element } from "@/types/element";
import { PeriodicTable } from "./periodic-table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Smartphone, Settings } from "lucide-react";
import SystemPageContent from "@/components/customs/system-page.content";

const MOBILE_BREAKPOINT = 640;

export default function HomePageSection() {
  const t = useTranslations("home");
  const tCommon = useTranslations("common");
  const tSettings = useTranslations("settings");
  const tTable = useTranslations("periodicTable");

  const [showWarning, setShowWarning] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    function check() {
      const isSmall = window.innerWidth < MOBILE_BREAKPOINT;
      const isPortrait = window.innerHeight > window.innerWidth;
      if (isSmall && isPortrait && !dismissed) {
        setShowWarning(true);
      } else {
        setShowWarning(false);
      }
    }

    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, [dismissed]);

  function handleDismissWarning() {
    setDismissed(true);
    setShowWarning(false);
  }

  return (
    <div className="min-h-screen bg-background w-full px-2 py-5 sm:px-4 sm:py-6 lg:px-8 lg:py-8">
      {/* ── Landscape warning dialog ── */}
      <Dialog
        open={showWarning}
        onOpenChange={(open) => !open && handleDismissWarning()}
      >
        <DialogContent className="max-w-xs rounded-2xl text-center">
          <DialogHeader className="items-center gap-3">
            <div className="flex items-center justify-center w-14 h-14 rounded-full bg-accent">
              {/*
                Decorative: the rotation illustrates the gesture rather than a
                forward/back direction, so it is not mirrored per locale.
              */}
              <Smartphone
                className="text-primary-text"
                style={{ transform: "rotate(-90deg)" }}
                size={28}
                strokeWidth={1.5}
                aria-hidden
              />
            </div>
            <DialogTitle className="text-base font-semibold">
              {t("rotate.title")}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
              {t("rotate.body")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col mt-2">
            <Button
              onClick={handleDismissWarning}
              variant="default"
              size="sm"
              className="w-full"
            >
              {t("rotate.dismiss")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* ── System settings dialog ── */}
      <SystemPageContent open={showSettings} onOpenChange={setShowSettings} />
      {/* ── Header row ── */}
      <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          {/* App Title and Description */}
          <div className="flex flex-col">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-primary-text">
              {tCommon("appName")}
            </h1>
            <p className="mt-1 text-sm sm:text-base text-muted-foreground max-w-md">
              {t("heroDescription")}
            </p>
          </div>
        </div>

        {/* Settings trigger button */}
        <Button
          variant="outline"
          size="icon"
          className="shrink-0 mt-1"
          onClick={() => setShowSettings(true)}
          aria-label={tSettings("open")}
        >
          <Settings className="w-4 h-4" />
        </Button>
      </div>

      <div className="mt-3 sm:mt-0 text-center">
        <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-foreground">
          {tTable("title")}
        </h2>
        <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
          {tTable("hint")}
        </p>
      </div>
      {/* ── Periodic table ── */}
      <PeriodicTable elements={elements as Element[]} />
    </div>
  );
}
