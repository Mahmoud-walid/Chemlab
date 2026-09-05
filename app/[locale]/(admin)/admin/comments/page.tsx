import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";

import { getDb } from "@/db/client";
import { listReportQueue } from "@/db/queries/comments";
import { requireAdminPermission } from "@/lib/admin/guard";
import { hasPermission } from "@/lib/authz";
import type { Locale } from "@/i18n/routing";
import { ReportQueue } from "./features/report-queue";

export const dynamic = "force-dynamic";

/**
 * The moderation queue.
 *
 * Oldest first, deliberately: a report that has waited three days is more
 * urgent than one from this morning, and a newest-first queue is one where the
 * oldest complaint is never reached.
 *
 * The comment BODY is shown here even for a deleted comment, unlike every
 * public read — a moderator deciding whether somebody should keep their
 * account needs to see what was written. That is what `comment:read` buys, and
 * it is why the page is guarded rather than merely unlinked.
 */
export default async function AdminCommentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  const actor = await requireAdminPermission("comment:read");
  const rows = await listReportQueue(getDb());

  const t = await getTranslations("admin.comments");
  const format = await getFormatter();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ReportQueue
          canModerate={hasPermission(actor, "comment:moderate")}
          canDelete={hasPermission(actor, "comment:delete")}
          rows={rows.map((row) => ({
            commentId: row.commentId,
            body: row.body,
            deleted: row.body === "",
            status: row.status,
            authorName: row.authorName,
            reportCount: row.reportCount,
            reasons: row.reasons,
            postedLabel: format.dateTime(row.createdAt, {
              dateStyle: "medium",
              timeStyle: "short",
            }),
            reportedLabel: format.dateTime(new Date(row.firstReportedAt), {
              dateStyle: "medium",
              timeStyle: "short",
            }),
          }))}
          labels={{
            author: t("author"),
            posted: t("posted"),
            firstReported: t("firstReported"),
            reasons: t("reasons"),
            status: t("status"),
            actions: t("actions"),
            hide: t("hide"),
            restore: t("restore"),
            remove: t("remove"),
            dismiss: t("dismiss"),
            hidden: t("hidden"),
            visible: t("visible"),
            flagged: t("flagged"),
            removedStatus: t("removedStatus"),
            done: t("done"),
            failed: t("failed"),
            deletedBody: t("deletedBody"),
          }}
        />
      )}
    </div>
  );
}
