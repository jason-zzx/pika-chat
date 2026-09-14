"use client";

import { useTranslations } from "next-intl";

import SettingsBadge from "@/components/settings/SettingsBadge";
import SettingsCard from "@/components/settings/SettingsCard";
import SettingsSection from "@/components/settings/SettingsSection";
import { useFileLimits } from "@/hooks/use-file-limits";
import { apiErrorMessage } from "@/lib/api/error-message";
import { formatBytes } from "@/lib/files/format";

/** Usage share at which the quota badge turns into a warning. */
const QUOTA_WARNING_PERCENT = 90;

function usagePercent(usedBytes: number, quotaBytes: number): number {
  if (quotaBytes === 0) {
    // A zero quota is legitimate: anything stored is over it.
    return usedBytes === 0 ? 0 : 100;
  }
  return Math.min(100, Math.round((usedBytes / quotaBytes) * 100));
}

/**
 * Storage usage from `GET /api/files/limits` — the same source the composer
 * checks uploads against, so the two can never disagree. A `null` quota means
 * unlimited; a zero quota is a real cap and is shown as one.
 */
export default function UsageCard() {
  const t = useTranslations("Settings.Files");
  const tErrors = useTranslations("Errors");
  const limits = useFileLimits();

  const data = limits.data;
  const quotaBytes = data?.quotaBytes ?? null;
  const usedBytes = data?.usedBytes ?? 0;
  const percent =
    data && quotaBytes !== null
      ? usagePercent(usedBytes, quotaBytes)
      : null;
  const tone: "neutral" | "destructive" =
    percent !== null && percent >= QUOTA_WARNING_PERCENT
      ? "destructive"
      : "neutral";

  return (
    <SettingsSection
      title={t("usageTitle")}
      description={t("usageDescription")}
    >
      <SettingsCard className="px-5 py-4">
        {limits.isError ? (
          <p className="text-sm text-destructive">
            {apiErrorMessage(
              limits.error,
              tErrors,
              "actions.loadStorageQuota",
            )}
          </p>
        ) : data ? (
          <SettingsBadge tone={tone}>
            {quotaBytes === null || percent === null
              ? t("usageLabelUnlimited", { used: formatBytes(usedBytes) })
              : t("usageLabel", {
                  used: formatBytes(usedBytes),
                  quota: formatBytes(quotaBytes),
                  percent,
                })}
          </SettingsBadge>
        ) : (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        )}
      </SettingsCard>
    </SettingsSection>
  );
}
