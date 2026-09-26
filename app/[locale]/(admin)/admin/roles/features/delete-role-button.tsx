"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

import { deleteRole } from "../actions";
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
import { toast } from "@/components/ui/sonner";

/**
 * Deleting a role, behind a confirmation.
 *
 * The page renders this only when the delete could actually succeed — not
 * protected, not a system role, nobody holding it. A disabled button here would
 * be four different refusals wearing one greyed-out coat, and the operator
 * would have to guess which.
 */
export function DeleteRoleButton({
  roleId,
  labels,
}: {
  roleId: string;
  labels: {
    action: string;
    confirmTitle: string;
    confirmBody: string;
    confirm: string;
    cancel: string;
    deleted: string;
    failed: string;
  };
}) {
  const t = useTranslations("admin.roles");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  function confirm() {
    startTransition(async () => {
      const result = await deleteRole({ roleId });
      setOpen(false);

      if (result.ok) {
        toast.success({ title: labels.deleted, description: "" });
        // Away from a page that no longer has anything to show.
        router.push("/admin/roles");
        return;
      }
      toast.error({
        title: labels.failed,
        description: (result.refusals ?? ["gone"])
          .map((code) => t(`refusals.${code}` as never))
          .join(" "),
      });
    });
  }

  return (
    <>
      <Button
        variant="destructive"
        size="sm"
        disabled={pending}
        onClick={() => setOpen(true)}
      >
        {labels.action}
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {labels.confirmBody}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={confirm} disabled={pending}>
              {labels.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
