import { getTranslations, setRequestLocale } from "next-intl/server";

import { requireAdminPermission } from "@/lib/admin/guard";
import { visibleNav } from "@/lib/admin/nav";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Locale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

/**
 * The dashboard.
 *
 * A landing page rather than a redirect to the first section the viewer can
 * open: a redirect makes `/admin` mean something different for every role, so
 * a bookmark or a shared link lands somewhere unpredictable.
 *
 * Its own `requirePermission` even though the layout already checked. The
 * layout is the gate for the tree, but a page that relies on its parent having
 * checked is one refactor away from being unprotected.
 */
export default async function AdminDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  const context = await requireAdminPermission("admin:access");
  const t = await getTranslations("admin");

  // The same filtering the sidebar uses, so the dashboard shows the viewer
  // exactly the sections they can actually open.
  const groups = visibleNav(context.permissions, context.isSuperAdmin).filter(
    (group) => group.labelKey !== "groups.overview",
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("dashboard.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("dashboard.subtitle")}
        </p>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("dashboard.noSections")}
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.labelKey} className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {t(group.labelKey)}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((item) => (
                <Card key={item.segment}>
                  <CardHeader>
                    <CardTitle className="text-base">
                      {t(item.labelKey)}
                    </CardTitle>
                    <CardDescription>
                      {t("dashboard.comingSoon")}
                    </CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
