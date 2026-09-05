import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

/**
 * Also what a viewer without `admin:access` receives.
 *
 * The layout answers a permission failure with 404 rather than 403, so this
 * page must read as "there is nothing here" and not "you are not allowed" —
 * otherwise the wording confirms what the status code is trying not to.
 */
export default async function AdminNotFound() {
  const t = await getTranslations("admin.notFound");

  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("body")}</p>
      <Button asChild variant="outline">
        <Link href="/admin">{t("back")}</Link>
      </Button>
    </div>
  );
}
