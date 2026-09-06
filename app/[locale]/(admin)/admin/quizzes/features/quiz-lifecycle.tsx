"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";
import {
  deleteQuiz,
  hardDeleteQuizAction,
  restoreQuiz,
  setQuizStatus,
} from "../actions";
import type { HardDeleteReason } from "@/lib/admin/hard-delete";
import type { ContentStatus } from "@/db/schema/content";
import type { QuizPublishBlocker } from "@/lib/admin/quiz-schema";
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
import { toast } from "@/components/ui/sonner";

export interface QuizLifecycleProps {
  id: string;
  slug: string;
  status: ContentStatus;
  isDeleted: boolean;
  publishedOnLabel: string | null;
  /** Computed on the server from the stored row, not from the form. */
  blockers: QuizPublishBlocker[];
  can: { publish: boolean; delete: boolean; deleteHard: boolean };
}

/**
 * The publication controls. Mirrors the lesson panel deliberately: the two
 * lifecycles are the same shape, and an author who has learned one should not
 * have to learn the other.
 *
 * Publishing is its own action rather than a field on the metadata form,
 * because it is the one change with a consequence outside the admin panel and
 * because it has preconditions a form field could not express.
 *
 * The blockers shown here are advisory — they are recomputed by the server
 * action against the stored row before anything is written. A disabled button
 * is a courtesy to the person clicking, never the check.
 */
export function QuizLifecycle({
  id,
  slug,
  status,
  isDeleted,
  publishedOnLabel,
  blockers,
  can,
}: QuizLifecycleProps) {
  const t = useTranslations("admin.quizzes.lifecycle");
  const tStatus = useTranslations("admin.quizzes.status");
  const tBlockers = useTranslations("admin.quizzes.blockers");
  const tErase = useTranslations("admin.quizzes.lifecycle.hardDeleteReasons");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const [typedSlug, setTypedSlug] = useState("");
  const [refusals, setRefusals] = useState<QuizPublishBlocker[]>([]);
  const [confirmingErase, setConfirmingErase] = useState(false);
  const [eraseRefusals, setEraseRefusals] = useState<HardDeleteReason[]>([]);

  const run = (
    action: () => Promise<{ ok: boolean; blockers?: QuizPublishBlocker[] }>,
  ) => {
    setRefusals([]);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success({ title: t("changed"), description: "" });
        router.refresh();
        return;
      }
      setRefusals(result.blockers ?? []);
      toast.error({ title: t("failed"), description: "" });
    });
  };

  const erase = () => {
    setEraseRefusals([]);
    startTransition(async () => {
      const result = await hardDeleteQuizAction(id);
      if (result.ok) {
        toast.success({ title: t("hardDeleteDone"), description: "" });
        // Back to the list: staying on the editor for a quiz that no longer
        // exists shows a form whose every save would 404.
        router.push("/admin/quizzes");
        return;
      }
      setEraseRefusals(result.refusals ?? []);
      toast.error({
        title: result.problem ?? t("hardDeleteRefusedTitle"),
        description: "",
      });
    });
  };

  const shown = refusals.length > 0 ? refusals : blockers;
  const canPublish = can.publish && blockers.length === 0;

  return (
    <section
      aria-labelledby="lifecycle-heading"
      className="space-y-4 rounded-lg border p-4"
    >
      <div className="space-y-1">
        <h2 id="lifecycle-heading" className="font-semibold">
          {t("heading")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("statusIs", { status: tStatus(status) })}{" "}
          {publishedOnLabel
            ? t("publishedOn", { date: publishedOnLabel })
            : t("neverPublished")}
        </p>
      </div>

      {shown.length > 0 && status !== "published" && (
        <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">{t("cannotPublish")}</p>
          <ul className="list-inside list-disc">
            {shown.map((blocker) => (
              <li key={blocker}>{tBlockers(blocker)}</li>
            ))}
          </ul>
        </div>
      )}

      {eraseRefusals.length > 0 && (
        <div
          role="alert"
          className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          <p className="font-medium">{t("hardDeleteRefusedTitle")}</p>
          <ul className="list-inside list-disc">
            {eraseRefusals.map((reason) => (
              <li key={reason}>{tErase(reason)}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {isDeleted ? (
          can.delete && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => run(() => restoreQuiz(id))}
            >
              {t("restore")}
            </Button>
          )
        ) : (
          <>
            {status !== "published" && can.publish && (
              <Button
                disabled={pending || !canPublish}
                onClick={() => setConfirmingPublish(true)}
              >
                {t("publish")}
              </Button>
            )}
            {status === "published" && can.publish && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => run(() => setQuizStatus(id, "draft"))}
              >
                {t("unpublish")}
              </Button>
            )}
            {/* Offered only for a draft that was never published — the two
                conditions the server also enforces. A button that is always
                visible and always refused teaches an operator to ignore it;
                the server still re-checks, because this copy is a courtesy
                and not the decision. */}
            {can.deleteHard &&
              status === "draft" &&
              publishedOnLabel === null && (
                <Button
                  variant="destructive"
                  disabled={pending}
                  onClick={() => {
                    setTypedSlug("");
                    setConfirmingErase(true);
                  }}
                >
                  {t("hardDelete")}
                </Button>
              )}
            {status !== "archived" && can.publish && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => run(() => setQuizStatus(id, "archived"))}
              >
                {t("archive")}
              </Button>
            )}
            {can.delete && (
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() => {
                  setTypedSlug("");
                  setConfirmingDelete(true);
                }}
              >
                {t("delete")}
              </Button>
            )}
          </>
        )}
      </div>

      <AlertDialog open={confirmingPublish} onOpenChange={setConfirmingPublish}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmPublishTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirmPublishBody", { slug })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => run(() => setQuizStatus(id, "published"))}
            >
              {t("confirmPublishAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmingErase} onOpenChange={setConfirmingErase}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("hardDeleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("hardDeleteConfirmBody", { slug })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* The slug, typed — the same interruption withdrawing uses, for a
              change that is strictly worse: a withdrawn quiz comes back, and
              this takes its questions and options with it. */}
          <div className="space-y-1.5">
            <Label htmlFor="confirm-erase-slug">{t("hardDelete")}</Label>
            <Input
              id="confirm-erase-slug"
              value={typedSlug}
              autoComplete="off"
              onChange={(event) => setTypedSlug(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t("hardDeleteHint")}
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={typedSlug !== slug}
              onClick={() => {
                setConfirmingErase(false);
                erase();
              }}
            >
              {t("hardDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirmDeleteBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* Typing the slug, not just clicking through. Withdrawing a quiz
              takes it off the public site, and the muscle memory of confirming
              a dialog is exactly what a typed confirmation interrupts. */}
          <div className="space-y-1.5">
            <Label htmlFor="confirm-slug">
              {t("confirmDeleteLabel", { slug })}
            </Label>
            <Input
              id="confirm-slug"
              value={typedSlug}
              autoComplete="off"
              onChange={(event) => setTypedSlug(event.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={typedSlug !== slug || pending}
              onClick={() => run(() => deleteQuiz(id))}
            >
              {t("confirmDeleteAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
