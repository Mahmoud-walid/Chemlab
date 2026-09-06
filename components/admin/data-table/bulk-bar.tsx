"use client";

import { useState } from "react";

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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BulkRefusal } from "@/lib/admin/bulk";

export interface BulkAction {
  id: string;
  label: string;
  /** Destructive actions get the typed confirmation. */
  confirm?: boolean;
  variant?: "default" | "outline" | "destructive";
}

export interface BulkBarLabels {
  /** "{count} selected" — interpolated here, so the count can be live. */
  selected: string;
  offPage: string;
  clear: string;
  confirmTitle: string;
  confirmBody: string;
  confirmCountLabel: string;
  apply: string;
  cancel: string;
  refusedTitle: string;
  refusedBody: string;
  refusedMissing: string;
  /** `PublishBlocker` keys → sentences, so the server sends keys not prose. */
  blockerNames: Record<string, string>;
}

/**
 * What is selected, and what can be done with it.
 *
 * Two things it says that a naive bar does not:
 *
 * - **How many selected rows are not on this page.** "12 selected" over a
 *   page showing three ticks reads as a bug; saying "9 not on this page"
 *   turns it into a fact.
 * - **Which rows refused, and why.** A bulk action here is all-or-nothing, so
 *   a refusal means nothing happened — and an operator who is told only that
 *   has no way to proceed. The list is what lets them deselect and retry.
 */
export function BulkBar({
  count,
  offPage,
  actions,
  refusals,
  pending,
  onApply,
  onClear,
  labels,
}: {
  count: number;
  offPage: number;
  actions: BulkAction[];
  refusals: BulkRefusal[];
  pending: boolean;
  onApply: (actionId: string) => void;
  onClear: () => void;
  labels: BulkBarLabels;
}) {
  const [confirming, setConfirming] = useState<BulkAction | null>(null);
  const [typed, setTyped] = useState("");

  if (count === 0 && refusals.length === 0) return null;

  const start = (action: BulkAction) => {
    if (action.confirm) {
      setTyped("");
      setConfirming(action);
      return;
    }
    onApply(action.id);
  };

  return (
    <div className="space-y-3">
      {count > 0 && (
        <div
          // A live region: the count changes as boxes are ticked, and a
          // screen-reader user should not have to go looking for it.
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-lg border bg-secondary px-4 py-3"
        >
          <span className="text-sm font-medium text-secondary-foreground">
            {labels.selected.replace("{count}", String(count))}
          </span>
          {offPage > 0 && (
            <span className="text-sm text-muted-foreground">
              {labels.offPage.replace("{count}", String(offPage))}
            </span>
          )}

          <div className="ms-auto flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button
                key={action.id}
                type="button"
                size="sm"
                variant={action.variant ?? "outline"}
                disabled={pending}
                onClick={() => start(action)}
              >
                {action.label}
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onClear}
              disabled={pending}
            >
              {labels.clear}
            </Button>
          </div>
        </div>
      )}

      {refusals.length > 0 && (
        <div
          role="alert"
          className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3"
        >
          <p className="text-sm font-semibold">{labels.refusedTitle}</p>
          <p className="text-sm text-muted-foreground">{labels.refusedBody}</p>
          <ul className="space-y-1 text-sm">
            {refusals.map((refusal) => (
              <li key={refusal.id}>
                <span className="font-medium">{refusal.label}</span>
                {" — "}
                {refusal.reason === "missing"
                  ? labels.refusedMissing
                  : (refusal.detail ?? [])
                      .map((key) => labels.blockerNames[key] ?? key)
                      .join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {labels.confirmTitle.replace("{count}", String(count))}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {labels.confirmBody.replace("{count}", String(count))}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* The COUNT, not a magic word.
              Typed rather than clicked through, because the muscle memory of
              confirming a dialog is exactly what a typed confirmation
              interrupts — and a bulk action is where that memory is most
              expensive. The count in particular, because a stale selection
              carried across pages is the likeliest thing to be wrong here,
              and typing "40" is what makes somebody look at it. It also needs
              no translation, where a word like APPLY would either be English
              for an Arabic operator or untypeable for an English one. */}
          <div className="space-y-1.5">
            <Label htmlFor="confirm-bulk">{labels.confirmCountLabel}</Label>
            <Input
              id="confirm-bulk"
              value={typed}
              inputMode="numeric"
              autoComplete="off"
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={typed.trim() !== String(count)}
              onClick={() => {
                const action = confirming;
                setConfirming(null);
                if (action) onApply(action.id);
              }}
            >
              {labels.apply}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
