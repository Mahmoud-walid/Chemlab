"use client";

import { useTransition } from "react";

import { useRouter } from "@/i18n/navigation";

import { Button } from "@/components/ui/button";

/**
 * Marks everything read.
 *
 * A router refresh rather than local state: this page is server-rendered, and
 * the honest way to show the result of a write is to re-read it. Optimism
 * belongs in the bell, where the alternative is a badge that lags a click.
 */
export function MarkAllRead({ label }: { label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const markAll = () => {
    startTransition(async () => {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ all: true }),
      }).catch(() => {});
      router.refresh();
    });
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={markAll}
      disabled={pending}
    >
      {label}
    </Button>
  );
}
