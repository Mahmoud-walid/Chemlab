"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

/**
 * Renders inside the admin chrome, so a failure does not drop the operator
 * onto a bare page with no way back.
 *
 * The error's message is deliberately not shown. In production it can carry a
 * stack, a query, or a connection string; the digest is enough to find the
 * real thing in the server logs.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("admin.error");

  useEffect(() => {
    console.error("Admin route error", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("body")}</p>
      {error.digest && (
        <p className="font-mono text-xs text-muted-foreground">
          {error.digest}
        </p>
      )}
      <Button onClick={reset}>{t("retry")}</Button>
    </div>
  );
}
