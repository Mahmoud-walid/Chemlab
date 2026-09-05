"use client";

import { useState, useTransition } from "react";

import { voidAttempt } from "../../actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";

export interface AdminAttempt {
  id: string;
  attemptNumber: number;
  status: string;
  percent: number;
  percentLabel: string;
  score: number | null;
  maxScore: number | null;
  passed: boolean | null;
  startedAtLabel: string;
  voidReason: string | null;
  userName: string | null;
  userEmail: string | null;
}

/**
 * The sittings, with the void control.
 *
 * Voiding is deliberately two steps: a reason has to be typed before the
 * confirm button does anything. A one-click void with an optional note is how
 * a record ends up struck out with nothing to explain it six months later,
 * least of all to the candidate asking why.
 *
 * The reason is also validated on the server — this form only makes the
 * requirement visible.
 */
export function AttemptsTable({
  quizSlug,
  attempts,
  canVoid,
  labels,
}: {
  quizSlug: string;
  attempts: AdminAttempt[];
  canVoid: boolean;
  labels: {
    candidate: string;
    attemptNumber: string;
    score: string;
    status: string;
    started: string;
    void: string;
    voiding: string;
    reasonLabel: string;
    reasonPlaceholder: string;
    confirm: string;
    cancel: string;
    deletedUser: string;
    empty: string;
    statuses: Record<string, string>;
  };
}) {
  const [pending, startTransition] = useTransition();
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  if (attempts.length === 0) {
    return <p className="text-sm text-muted-foreground">{labels.empty}</p>;
  }

  function submit(attemptId: string) {
    startTransition(async () => {
      const result = await voidAttempt({ attemptId, reason, quizSlug });
      if (result.ok) {
        setOpenFor(null);
        setReason("");
        toast.success({ title: labels.void, description: "" });
        return;
      }
      toast.error({ title: result.problem ?? labels.void, description: "" });
    });
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-start">
          <tr>
            <th className="p-3 font-medium">{labels.candidate}</th>
            <th className="p-3 font-medium">{labels.attemptNumber}</th>
            <th className="p-3 font-medium">{labels.score}</th>
            <th className="p-3 font-medium">{labels.status}</th>
            <th className="p-3 font-medium">{labels.started}</th>
            {canVoid && <th className="p-3" />}
          </tr>
        </thead>
        <tbody className="divide-y">
          {attempts.map((attempt) => {
            const voidable =
              canVoid &&
              (attempt.status === "submitted" || attempt.status === "expired");

            return (
              <tr key={attempt.id} className="align-top">
                <td className="p-3">
                  {/* The account may be gone — `users` rows are deletable and
                      the attempt outlives them. Naming that is better than a
                      blank cell. */}
                  {attempt.userEmail ?? attempt.userName ?? (
                    <span className="text-muted-foreground">
                      {labels.deletedUser}
                    </span>
                  )}
                </td>
                <td className="p-3 tabular-nums">{attempt.attemptNumber}</td>
                <td className="p-3 tabular-nums">
                  {attempt.status === "in_progress"
                    ? "—"
                    : attempt.percentLabel}
                </td>
                <td className="p-3">
                  <Badge
                    variant={
                      attempt.status === "voided" ? "outline" : "secondary"
                    }
                  >
                    {labels.statuses[attempt.status] ?? attempt.status}
                  </Badge>
                  {attempt.voidReason && (
                    <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                      {attempt.voidReason}
                    </p>
                  )}
                </td>
                <td className="p-3 text-muted-foreground">
                  {attempt.startedAtLabel}
                </td>

                {canVoid && (
                  <td className="p-3">
                    {openFor === attempt.id ? (
                      <div className="w-64 space-y-2">
                        <Label htmlFor={`reason-${attempt.id}`}>
                          {labels.reasonLabel}
                        </Label>
                        <Textarea
                          id={`reason-${attempt.id}`}
                          rows={2}
                          value={reason}
                          disabled={pending}
                          placeholder={labels.reasonPlaceholder}
                          onChange={(event) => setReason(event.target.value)}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={pending || reason.trim().length < 5}
                            onClick={() => submit(attempt.id)}
                          >
                            {pending ? labels.voiding : labels.confirm}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => {
                              setOpenFor(null);
                              setReason("");
                            }}
                          >
                            {labels.cancel}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      voidable && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setOpenFor(attempt.id);
                            setReason("");
                          }}
                        >
                          {labels.void}
                        </Button>
                      )
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
