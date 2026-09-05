"use client";

import { useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/sonner";
import { dismissReports, moderateComment, removeComment } from "../actions";

export interface QueueRow {
  commentId: string;
  body: string;
  deleted: boolean;
  status: "visible" | "hidden" | "flagged" | "removed";
  authorName: string | null;
  reportCount: number;
  reasons: string[];
  postedLabel: string;
  reportedLabel: string;
}

export interface QueueLabels {
  author: string;
  posted: string;
  firstReported: string;
  reasons: string;
  status: string;
  actions: string;
  hide: string;
  restore: string;
  remove: string;
  dismiss: string;
  hidden: string;
  visible: string;
  flagged: string;
  removedStatus: string;
  done: string;
  failed: string;
  deletedBody: string;
}

/**
 * The queue's rows and what a moderator can do to them.
 *
 * The buttons are gated by permission as well as hidden without it — the
 * server action re-checks, so a missing button is the affordance and
 * `requirePermission` is the rule. A UI-only gate is a suggestion.
 */
export function ReportQueue({
  rows,
  canModerate,
  canDelete,
  labels,
}: {
  rows: QueueRow[];
  canModerate: boolean;
  canDelete: boolean;
  labels: QueueLabels;
}) {
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<{ ok: boolean }>) => {
    startTransition(async () => {
      const result = await action().catch(() => ({ ok: false }));
      if (result.ok) {
        toast.success({ title: labels.done, description: "" });
      } else {
        toast.error({ title: labels.failed, description: "" });
      }
    });
  };

  const statusLabel = (status: QueueRow["status"]) =>
    status === "hidden"
      ? labels.hidden
      : status === "removed"
        ? labels.removedStatus
        : status === "flagged"
          ? labels.flagged
          : labels.visible;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{labels.author}</TableHead>
          <TableHead>{labels.reasons}</TableHead>
          <TableHead>{labels.firstReported}</TableHead>
          <TableHead>{labels.status}</TableHead>
          <TableHead className="text-end">{labels.actions}</TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.commentId}>
            <TableCell className="max-w-md align-top">
              <p className="text-sm font-medium">{row.authorName ?? "—"}</p>
              {/* Plain text in a text node: a reported comment is the LAST
                  place to start interpreting markup. */}
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                {row.deleted ? labels.deletedBody : row.body}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {labels.posted}: {row.postedLabel}
              </p>
            </TableCell>

            <TableCell className="align-top">
              <div className="flex flex-wrap gap-1">
                {row.reasons.map((reason) => (
                  <Badge key={reason} variant="outline">
                    {reason}
                  </Badge>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                ×{row.reportCount}
              </p>
            </TableCell>

            <TableCell className="align-top text-sm">
              {row.reportedLabel}
            </TableCell>

            <TableCell className="align-top">
              <Badge
                variant={row.status === "visible" ? "secondary" : "destructive"}
              >
                {statusLabel(row.status)}
              </Badge>
            </TableCell>

            <TableCell className="align-top">
              <div className="flex flex-wrap justify-end gap-1">
                {canModerate && (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          moderateComment(
                            row.commentId,
                            row.status === "hidden" ? "visible" : "hidden",
                          ),
                        )
                      }
                    >
                      {row.status === "hidden" ? labels.restore : labels.hide}
                    </Button>

                    {/* The "this is fine" path. Without it the only ways to
                        clear the queue are to hide something acceptable or to
                        leave the item for ever, and both teach a moderator to
                        ignore the queue. */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => run(() => dismissReports(row.commentId))}
                    >
                      {labels.dismiss}
                    </Button>
                  </>
                )}

                {canDelete && !row.deleted && (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={pending}
                    onClick={() => run(() => removeComment(row.commentId))}
                  >
                    {labels.remove}
                  </Button>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
