import { desc, eq } from "drizzle-orm";
import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";

import { getDb } from "@/db/client";
import { hasDatabase } from "@/db/queries/availability";
import { activityEvents } from "@/db/schema/activity";
import { users } from "@/db/schema/auth";
import { requireAdminPermission } from "@/lib/admin/guard";
import { hasPermission } from "@/lib/authz";
import { getSettings } from "@/lib/settings/get";
import {
  configStatus,
  configuredOAuthProviders,
} from "@/lib/settings/config-status";
import {
  SETTING_SECTIONS,
  settingsInSection,
  type SettingSection,
} from "@/lib/settings/registry";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "@/i18n/navigation";
import { locales, type Locale } from "@/i18n/routing";
import {
  SettingsForm,
  type SettingField,
  type SettingOption,
  type SettingStatusRow,
} from "./features/settings-form";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  const actor = await requireAdminPermission("setting:read");
  // Per key, from the registry — the Security section is guarded by its own
  // permission, so "can edit" is not one answer for the whole screen.
  const canEditSection = (section: SettingSection) =>
    settingsInSection(section).every((definition) =>
      hasPermission(actor, definition.permission),
    );

  // Environment presence only. Booleans cross this boundary, never a value.
  const status = configStatus();
  const availableProviders = new Set(configuredOAuthProviders());

  const resolved = await getSettings();

  const t = await getTranslations("admin.settings");
  const format = await getFormatter();

  const history = hasDatabase()
    ? await getDb()
        .select({
          id: activityEvents.id,
          metadata: activityEvents.metadata,
          createdAt: activityEvents.createdAt,
          actorName: users.name,
          actorEmail: users.email,
        })
        .from(activityEvents)
        .leftJoin(users, eq(users.id, activityEvents.actorId))
        .where(eq(activityEvents.verb, "admin.settings_changed"))
        .orderBy(desc(activityEvents.createdAt))
        .limit(10)
        .catch(() => [])
    : [];

  /** Option labels: locales get their own names, everything else its key. */
  const optionsFor = (key: string, values?: readonly string[]) => {
    if (!values) return undefined;
    return values.map((value): SettingOption => {
      const isLocale = (locales as readonly string[]).includes(value);
      return {
        value,
        label: isLocale
          ? t(`locales.${value}` as never)
          : t(`options.${key}.${value}` as never),
        disabledReason:
          key === "security.allowedOAuthProviders" &&
          !availableProviders.has(value)
            ? t("providerNotConfigured")
            : undefined,
      };
    });
  };

  const fieldsFor = (section: SettingSection): SettingField[] =>
    settingsInSection(section).map((definition) => {
      const current = resolved[definition.key];
      return {
        key: definition.key,
        kind: definition.kind,
        value: current?.value ?? definition.default,
        // Null when no row exists, which is a distinct state from "a row
        // exists and was written at this time" — the write action compares it.
        seenAt: current?.updatedAt ? current.updatedAt.toISOString() : null,
        label: t(`fields.${definition.key}` as never),
        help: t.has(`help.${definition.key}` as never)
          ? t(`help.${definition.key}` as never)
          : undefined,
        options: optionsFor(definition.key, definition.options),
      };
    });

  const statusFor = (section: SettingSection): SettingStatusRow[] => {
    if (section === "notifications") {
      return [
        {
          id: "webPush",
          label: t("status.webPush"),
          configured: status.webPush,
          help: t("status.webPushHelp"),
        },
        {
          id: "slack",
          label: t("status.slack"),
          configured: status.slack,
        },
        {
          id: "email",
          label: t("status.email"),
          configured: status.email,
        },
      ];
    }
    if (section === "security") {
      return [
        {
          id: "googleOAuth",
          label: t("status.googleOAuth"),
          configured: status.googleOAuth,
          help: t("status.googleOAuthHelp"),
        },
      ];
    }
    if (section === "general") {
      return [
        {
          id: "cloudinary",
          label: t("status.cloudinary"),
          configured: status.cloudinary,
          help: t("status.cloudinaryHelp"),
        },
      ];
    }
    return [];
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* Said on the screen, because "why is the Cloudinary key not here" is
          otherwise a reasonable question with no visible answer. */}
      <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        {t("envNote")}
      </p>

      <Tabs defaultValue={SETTING_SECTIONS[0]}>
        <TabsList>
          {SETTING_SECTIONS.map((section) => (
            <TabsTrigger key={section} value={section}>
              {t(`sections.${section}` as never)}
            </TabsTrigger>
          ))}
        </TabsList>

        {SETTING_SECTIONS.map((section) => (
          <TabsContent key={section} value={section} className="space-y-6 pt-4">
            <SettingsForm
              section={section}
              canEdit={canEditSection(section)}
              fields={fieldsFor(section)}
              status={statusFor(section)}
              labels={{
                save: t("save"),
                saving: t("saving"),
                saved: t("saved"),
                readOnly:
                  section === "security"
                    ? t("readOnlySecurity")
                    : t("readOnly"),
                configured: t("status.configured"),
                notConfigured: t("status.notConfigured"),
              }}
            />

            {section === "localization" && (
              <p className="text-sm text-muted-foreground">
                {t("localeNote", {
                  locale: String(
                    resolved["general.defaultLocale"]?.value ?? "en",
                  ),
                })}
              </p>
            )}

            {section === "features" && (
              <p className="text-sm text-muted-foreground">
                {t("pagesNote")}{" "}
                <Link
                  href="/admin/pages"
                  className="font-medium underline underline-offset-4"
                >
                  {t("pagesLink")}
                </Link>
              </p>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <section
        aria-labelledby="history"
        className="space-y-2 rounded-lg border p-4"
      >
        <h2 id="history" className="font-semibold">
          {t("history.heading")}
        </h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("history.empty")}</p>
        ) : (
          <ul className="space-y-1 text-sm text-muted-foreground">
            {history.map((entry) => (
              <li key={entry.id}>
                {t("history.entry", {
                  key: String(
                    (entry.metadata as { key?: string } | null)?.key ?? "—",
                  ),
                  actor:
                    entry.actorEmail ??
                    entry.actorName ??
                    t("history.unknownActor"),
                })}{" "}
                ·{" "}
                {format.dateTime(entry.createdAt, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
