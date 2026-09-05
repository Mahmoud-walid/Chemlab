import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";

import {
  ACTIVITY_LIST_SPEC,
  listActivity,
  parseVerbFilter,
} from "@/db/queries/admin/activity";
import { parseListParams } from "@/db/queries/admin/list-params";
import { requireAdminPermission } from "@/lib/admin/guard";
import { verbGroups } from "@/lib/activity/verbs";
import { hasPermission } from "@/lib/authz";
import { ExportButton } from "@/components/admin/export-button";
import { StatusFilter } from "@/components/admin/status-filter";
import type { Locale } from "@/i18n/routing";
import { ActivityTable } from "./features/activity-table";

export const dynamic = "force-dynamic";

export default async function AdminActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  const actor = await requireAdminPermission("activity:read");
  // The permission decides what the QUERY selects, not what the table renders.
  const canSeePii = hasPermission(actor, "activity:read_pii");
  // Reading the stream and taking a copy of it away are separate grants: the
  // file leaves the building, and the retention window stops applying to it
  // the moment it does.
  const canExport = hasPermission(actor, "activity:export");

  const raw = await searchParams;
  const list = parseListParams(raw, ACTIVITY_LIST_SPEC);

  const groups = verbGroups();
  const rawGroup = Array.isArray(raw.status) ? raw.status[0] : raw.status;
  const group = groups.includes(rawGroup ?? "") ? rawGroup : undefined;

  const { rows, total, pages } = await listActivity(
    list,
    { verb: parseVerbFilter(raw.verb), group },
    canSeePii,
  );

  const t = await getTranslations("admin.activity");
  const tTable = await getTranslations("admin.table");
  const format = await getFormatter();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("subtitle", { count: format.number(total) })}
        </p>
      </div>

      {/* Said plainly rather than left as two absent columns: a reader should
          know something is being withheld and what would let them see it. */}
      {!canSeePii && (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          {t("piiWithheld")}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusFilter
          label={t("filterByGroup")}
          current={group ?? "all"}
          options={[
            { value: "all", label: t("allGroups") },
            ...groups.map((value) => ({
              value,
              label: t(`groups.${value}` as never),
            })),
          ]}
        />
        {canExport && (
          <ExportButton
            dataset="events"
            label={t("export")}
            hint={canSeePii ? t("exportHintPii") : t("exportHint")}
            carryFilters
          />
        )}
      </div>

      <ActivityTable
        canSeePii={canSeePii}
        rows={rows.map((row) => ({
          id: row.id,
          verb: row.verb,
          verbLabel: t(`verbs.${row.verb}` as never),
          group: row.verb.split(".")[0]!,
          // A deleted account is not the same as an anonymous visitor, and the
          // table should not merge them: `actor_id` null with no name is a
          // visitor, an event whose actor was removed is a closed account.
          actorLabel:
            row.actorEmail ??
            row.actorName ??
            (row.actorId ? t("deletedActor") : t("anonymous")),
          objectLabel: row.objectType
            ? `${row.objectType}${row.objectId ? ` · ${row.objectId}` : ""}`
            : t("noObject"),
          ipAddress: row.ipAddress,
          userAgent: row.userAgent,
          whenLabel: format.dateTime(row.createdAt, {
            dateStyle: "medium",
            timeStyle: "short",
          }),
        }))}
        page={list.page}
        pages={pages}
        labels={{
          when: t("columns.when"),
          actor: t("columns.actor"),
          verb: t("columns.verb"),
          object: t("columns.object"),
          ip: t("columns.ip"),
          agent: t("columns.agent"),
          withheld: t("piiWithheld"),
          table: {
            search: tTable("search"),
            searchPlaceholder: t("searchPlaceholder"),
            empty: t("empty"),
            previous: tTable("previous"),
            next: tTable("next"),
            pageStatus: tTable("pageStatus", { page: list.page, pages }),
            sortBy: tTable("sortBy"),
            columns: tTable("columns"),
            columnsHint: tTable("columnsHint"),
            loading: tTable("loading"),
          },
        }}
      />
    </div>
  );
}
