import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";

import {
  USER_LIST_SPEC,
  listUsers,
  type UserSort,
} from "@/db/queries/admin/users";
import { parseListParams } from "@/db/queries/admin/list-params";
import { requireAdminPermission } from "@/lib/admin/guard";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { Badge } from "@/components/ui/badge";
import { SearchField } from "./features/search-field";

export const dynamic = "force-dynamic";

/**
 * The people on the platform.
 *
 * The sidebar has linked here since the admin shell shipped; until now the
 * route did not exist, so the link 404'd. Its own `user:read` gate, as every
 * admin page has: the layout is the gate for the tree, but a page that leans
 * on its parent having checked is one refactor from being unprotected.
 */
export default async function AdminUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  await requireAdminPermission("user:read");

  const raw = await searchParams;
  const list = parseListParams<UserSort>(raw, USER_LIST_SPEC);
  const page = await listUsers(list, list.query);

  const t = await getTranslations("admin.users");
  const format = await getFormatter();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <SearchField
        placeholder={t("searchPlaceholder")}
        label={t("searchLabel")}
      />

      {page.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-start">
              <tr>
                <th className="p-3 text-start font-medium">
                  {t("columns.person")}
                </th>
                <th className="p-3 text-start font-medium">
                  {t("columns.roles")}
                </th>
                <th className="p-3 text-start font-medium">
                  {t("columns.joined")}
                </th>
                <th className="p-3 text-start font-medium">
                  {t("columns.lastSeen")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {page.rows.map((row) => (
                <tr key={row.id} className="hover:bg-muted/30">
                  <td className="p-3">
                    <Link
                      href={`/admin/users/${row.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {row.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{row.email}</p>
                  </td>
                  <td className="p-3">
                    <span className="flex flex-wrap gap-1">
                      {row.roleKeys.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        row.roleKeys.map((key) => (
                          <Badge key={key} variant="outline">
                            {key}
                          </Badge>
                        ))
                      )}
                    </span>
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {format.dateTime(row.createdAt, { dateStyle: "medium" })}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {/* The newest session, which is as close to "last seen" as
                        sessions can honestly say — a signed-in tab left open
                        does not refresh it. Labelled as last sign-in for that
                        reason. */}
                    {row.lastSeenAt
                      ? format.dateTime(new Date(row.lastSeenAt), {
                          dateStyle: "medium",
                        })
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        {t("pageOf", { page: list.page, pages: page.pages, total: page.total })}
      </p>
    </div>
  );
}
