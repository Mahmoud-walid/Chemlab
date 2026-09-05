import { NextIntlClientProvider } from "next-intl";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import {
  getMessages,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";

import { AdminHeader } from "@/components/admin/admin-header";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { visibleNav } from "@/lib/admin/nav";
import {
  ForbiddenError,
  UnauthenticatedError,
  requirePermission,
} from "@/lib/authz";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

/**
 * The admin panel's gate and its chrome.
 *
 * A server component, so an unauthorised request never receives admin HTML —
 * not a flash, not a skeleton, not a nav label. The middleware's cookie check
 * is only an optimisation that saves a round trip; THIS is the boundary, and
 * every page and server action inside re-checks for itself.
 *
 * Signed out redirects to sign-in. Signed in without permission gets a 404,
 * not a 403: a 403 confirms that /admin exists and is worth attacking.
 */
export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  let context;
  try {
    context = await requirePermission("admin:access");
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      // The locale-aware redirect: `next/navigation`'s would drop the /ar
      // prefix and send an Arabic-speaking admin to the English sign-in page.
      redirect({
        href: { pathname: "/sign-in", query: { next: "/admin" } },
        locale: locale as Locale,
      });
    }
    if (error instanceof ForbiddenError) notFound();
    throw error;
  }

  const t = await getTranslations("admin");

  // Filtered on the server, so a link the viewer cannot use is never in the
  // markup. Cosmetic — see lib/admin/nav.ts — but it also keeps the panel's
  // shape from advertising features to people who cannot reach them.
  const groups = visibleNav(context.permissions, context.isSuperAdmin);

  // Read here rather than left to the client, so the sidebar renders at the
  // width the viewer last chose instead of expanding and then snapping shut.
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false";

  // The root layout withholds the admin namespace from the public bundle, so
  // it is provided again here — for this subtree only, and only to viewers who
  // have already passed the gate above.
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <SidebarProvider defaultOpen={sidebarOpen}>
        <AdminSidebar
          groups={groups.map((group) => ({
            label: t(group.labelKey),
            items: group.items.map((item) => ({
              segment: item.segment,
              label: t(item.labelKey),
            })),
          }))}
          labels={{ nav: t("navLabel"), title: t("title") }}
        />
        <SidebarInset>
          <AdminHeader
            labels={{
              toggleSidebar: t("toggleSidebar"),
              backToSite: t("backToSite"),
              breadcrumb: t("breadcrumbLabel"),
            }}
            crumbLabels={Object.fromEntries(
              groups.flatMap((group) =>
                group.items.map((item) => [item.labelKey, t(item.labelKey)]),
              ),
            )}
          />
          <main className="flex-1 p-4 sm:p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </NextIntlClientProvider>
  );
}
