"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { setPageEnabled, setPageInNav } from "../actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/sonner";

export interface PageRow {
  routeKey: string;
  title: string;
  isEnabled: boolean;
  showInNav: boolean;
  /** False for routes the nav never links to — an element detail page. */
  navRelevant: boolean;
  changedLabel: string | null;
}

/**
 * The page switches.
 *
 * This is the one screen in the admin panel where `useOptimistic` is right: a
 * switch that waits for a round trip before moving reads as broken, and the
 * change it represents is a single boolean — so a rollback restores exactly
 * what was there, with nothing for the operator to reconstruct. The full-form
 * editors elsewhere deliberately do not do this.
 *
 * Closing goes through a confirmation; opening does not. The asymmetry is the
 * point: taking a page away from every visitor deserves a pause, giving it
 * back does not.
 */
export function PagesTable({
  rows,
  canToggle,
  labels,
}: {
  rows: PageRow[];
  canToggle: boolean;
  labels: {
    page: string;
    route: string;
    state: string;
    nav: string;
    changed: string;
    open: string;
    closed: string;
  };
}) {
  const t = useTranslations("admin.pages");
  const [, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<PageRow | null>(null);

  // The optimistic layer sits over the server's rows. When the action fails,
  // this state is discarded and React re-renders from `rows` — which is the
  // rollback, and why nothing here tries to undo anything by hand.
  const [optimistic, applyOptimistic] = useOptimistic(
    rows,
    (current, change: { routeKey: string; patch: Partial<PageRow> }) =>
      current.map((row) =>
        row.routeKey === change.routeKey ? { ...row, ...change.patch } : row,
      ),
  );

  const toggleEnabled = (row: PageRow, next: boolean) => {
    startTransition(async () => {
      applyOptimistic({ routeKey: row.routeKey, patch: { isEnabled: next } });
      const result = await setPageEnabled(row.routeKey, next);
      if (result.ok) {
        toast.success({
          title: next
            ? t("opened", { page: row.title })
            : t("closed", { page: row.title }),
          description: "",
        });
        return;
      }
      // The optimistic value is already gone by the time this renders; the
      // toast is what tells the operator the switch snapped back and why.
      toast.error({
        title: t("reverted"),
        description: result.problem ?? "",
      });
    });
  };

  const toggleNav = (row: PageRow, next: boolean) => {
    startTransition(async () => {
      applyOptimistic({ routeKey: row.routeKey, patch: { showInNav: next } });
      const result = await setPageInNav(row.routeKey, next);
      if (!result.ok) {
        toast.error({
          title: t("reverted"),
          description: result.problem ?? "",
        });
      }
    });
  };

  return (
    <>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{labels.page}</TableHead>
              <TableHead>{labels.route}</TableHead>
              <TableHead>{labels.state}</TableHead>
              <TableHead>{labels.nav}</TableHead>
              <TableHead>{labels.changed}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {optimistic.map((row) => (
              <TableRow key={row.routeKey}>
                <TableCell className="font-medium">{row.title}</TableCell>
                <TableCell>
                  <code className="text-xs text-muted-foreground">
                    {row.routeKey}
                  </code>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={row.isEnabled}
                      disabled={!canToggle}
                      aria-label={
                        row.isEnabled
                          ? t("toggle.close", { page: row.title })
                          : t("toggle.open", { page: row.title })
                      }
                      onCheckedChange={(next) => {
                        if (!next) {
                          // Closing is the destructive direction, so it asks.
                          setConfirming(row);
                          return;
                        }
                        toggleEnabled(row, true);
                      }}
                    />
                    <Badge variant={row.isEnabled ? "default" : "outline"}>
                      {row.isEnabled ? labels.open : labels.closed}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell>
                  {row.navRelevant ? (
                    <Switch
                      checked={row.showInNav && row.isEnabled}
                      disabled={!canToggle || !row.isEnabled}
                      aria-label={
                        row.showInNav
                          ? t("inNav.hide", { page: row.title })
                          : t("inNav.show", { page: row.title })
                      }
                      onCheckedChange={(next) => toggleNav(row, next)}
                    />
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {row.changedLabel ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("confirmCloseTitle", { page: confirming?.title ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirmCloseBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirming) toggleEnabled(confirming, false);
                setConfirming(null);
              }}
            >
              {t("confirmCloseAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
