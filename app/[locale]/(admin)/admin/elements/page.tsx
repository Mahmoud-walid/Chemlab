import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";

import {
  ELEMENT_LIST_SPEC,
  listElementsForAdmin,
  type ElementSort,
} from "@/db/queries/admin/elements";
import { parseListParams } from "@/db/queries/admin/list-params";
import { requireAdminPermission } from "@/lib/admin/guard";
import type { Locale } from "@/i18n/routing";
import { ElementsTable } from "./features/elements-table";

export const dynamic = "force-dynamic";

export default async function AdminElementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  // Its own gate. The layout checked `admin:access`; reading element records
  // needs `element:read`, and a page that leans on its parent is one refactor
  // away from being unprotected.
  await requireAdminPermission("element:read");

  const list = parseListParams<ElementSort>(
    await searchParams,
    ELEMENT_LIST_SPEC,
  );
  const { rows, total, pages } = await listElementsForAdmin(list);

  const t = await getTranslations("admin.elements");
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

      <ElementsTable
        rows={rows.map((row) => ({
          ...row,
          atomicMassLabel: format.number(row.atomicMass, {
            maximumFractionDigits: 4,
          }),
          updatedLabel: format.dateTime(row.updatedAt, {
            dateStyle: "medium",
          }),
        }))}
        page={list.page}
        pages={pages}
        labels={{
          number: t("columns.number"),
          symbol: t("columns.symbol"),
          name: t("columns.name"),
          category: t("columns.category"),
          atomicMass: t("columns.atomicMass"),
          updated: t("columns.updated"),
          table: {
            search: tTable("search"),
            searchPlaceholder: t("searchPlaceholder"),
            empty: tTable("empty"),
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
