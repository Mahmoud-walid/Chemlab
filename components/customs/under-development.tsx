import React from "react";
import { useTranslations } from "next-intl";
import { FiAlertTriangle } from "react-icons/fi";

/**
 * Placeholder for routes that exist in the nav but are not built yet
 * (Experiments and Games, both deferred in epic #8).
 */
export function UnderDevelopment() {
  const t = useTranslations("underDevelopment");
  const tCommon = useTranslations("common");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <FiAlertTriangle className="mb-4 h-16 w-16 text-yellow-500" />
      <h1 className="mb-2 text-2xl font-bold">{t("title")}</h1>
      <p className="text-gray-600">
        {t("body", { appName: tCommon("appName") })}
      </p>
    </div>
  );
}

export default UnderDevelopment;
