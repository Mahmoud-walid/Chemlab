import { asc } from "drizzle-orm";
import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";

import { getDb } from "@/db/client";
import { pages } from "@/db/schema/content";
import { requireAdminPermission } from "@/lib/admin/guard";
import { hasPermission } from "@/lib/authz";
import { CLOSABLE_ROUTES } from "@/lib/pages/routes";
import type { Locale } from "@/i18n/routing";
import { PagesTable } from "./features/pages-table";

export const dynamic = "force-dynamic";

export default async function AdminPagesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  const actor = await requireAdminPermission("page:read");

  const rows = await getDb().select().from(pages).orderBy(asc(pages.routeKey));

  const t = await getTranslations("admin.pages");
  const tTitles = await getTranslations("pages.titles");
  const format = await getFormatter();

  // The route list is the source of the human name and of whether the nav
  // links to it at all; the table is the source of the state. A row in one and
  // not the other is what `pnpm pages:check` exists to catch.
  const known = new Map(
    CLOSABLE_ROUTES.map((route) => [route.routeKey, route]),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("neverEmpty")}
        </p>
      ) : (
        <PagesTable
          canToggle={hasPermission(actor, "page:toggle")}
          rows={rows.map((row) => {
            const route = known.get(row.routeKey);
            return {
              routeKey: row.routeKey,
              title: route ? tTitles(route.titleKey) : row.routeKey,
              isEnabled: row.isEnabled,
              showInNav: row.showInNav,
              navRelevant: route?.inNav ?? false,
              changedLabel: row.disabledAt
                ? format.dateTime(row.disabledAt, { dateStyle: "medium" })
                : null,
            };
          })}
          labels={{
            page: t("columns.page"),
            route: t("columns.route"),
            state: t("columns.state"),
            nav: t("columns.nav"),
            changed: t("columns.changed"),
            open: t("state.open"),
            closed: t("state.closed"),
          }}
        />
      )}

      {/* Said on the screen, not only in a comment: an operator looking for a
          switch that is not here should learn why rather than assume a bug. */}
      <p className="text-sm text-muted-foreground">{t("alwaysOpen")}</p>
    </div>
  );
}
