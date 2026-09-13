"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import SettingsBadge from "@/components/settings/SettingsBadge";
import SettingsCard from "@/components/settings/SettingsCard";
import SettingsSection from "@/components/settings/SettingsSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorMessage } from "@/lib/api/error-message";
import { fetchInstanceSettings, updateInstanceSettings } from "@/lib/api/instance";
import { BYTES_PER_MB } from "@/lib/files/constants";
import { parseQuotaMb } from "@/lib/files/quota-input";
import { formatBytes } from "@/lib/files/format";

const INPUT_ID = "instance-storage-quota-mb";

/**
 * Instance-wide default attachment storage quota. Sits beside the registration
 * toggle on /settings/users because that is where an operator manages the
 * instance as a whole. The value is MB on the wire and bytes in the database.
 */
export default function StorageQuotaCard() {
  const t = useTranslations("Admin");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");
  const settings = useQuery({
    queryKey: ["instance-settings"],
    queryFn: fetchInstanceSettings,
  });
  const mutation = useMutation({
    mutationFn: (quotaMb: number | null) =>
      updateInstanceSettings({ fileStorageQuotaMb: quotaMb }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["instance-settings"] });
    },
  });

  const quotaMb = settings.data?.fileStorageQuotaMb ?? null;
  const badgeTone: "success" | "neutral" =
    quotaMb === null ? "neutral" : "success";
  // Render-time state adjustment rather than an effect (see
  // react-hooks/set-state-in-effect): seed the draft when the fetch lands and
  // re-sync it when the server value changes.
  const [syncedMb, setSyncedMb] = useState<number | null | undefined>(
    undefined,
  );
  if (settings.data !== undefined && quotaMb !== syncedMb) {
    setSyncedMb(quotaMb);
    setValue(quotaMb === null ? "" : String(quotaMb));
  }
  const parsed = parseQuotaMb(value);
  const canSave =
    parsed !== undefined &&
    !settings.isPending &&
    !mutation.isPending &&
    parsed !== quotaMb;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (parsed === undefined) {
      return;
    }
    await mutation.mutateAsync(parsed);
  }

  return (
    <SettingsSection title={t("quotaGlobalTitle")}>
      <SettingsCard>
        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-end sm:justify-between"
        >
          <div className="flex min-w-0 flex-col gap-1.5">
            <SettingsBadge tone={badgeTone}>
              {quotaMb === null
                ? t("quotaGlobalUnlimited")
                : t("quotaGlobalValue", {
                    value: formatBytes(quotaMb * BYTES_PER_MB),
                  })}
            </SettingsBadge>
            <p className="text-sm text-muted-foreground">
              {t("quotaGlobalDescription")}
            </p>
          </div>
          <div className="flex shrink-0 items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={INPUT_ID}>{t("quotaGlobalLabel")}</Label>
              <Input
                id={INPUT_ID}
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={value}
                placeholder={t("quotaGlobalUnlimited")}
                onChange={(event) => setValue(event.target.value)}
                className="w-40"
              />
            </div>
            <Button type="submit" size="sm" disabled={!canSave}>
              {mutation.isPending ? t("quotaSaving") : t("quotaSave")}
            </Button>
          </div>
        </form>
        {settings.error || mutation.error ? (
          <p className="px-5 pb-4 text-sm text-destructive">
            {apiErrorMessage(
              mutation.error ?? settings.error,
              tErrors,
              mutation.error
                ? "actions.saveStorageQuota"
                : "actions.loadStorageQuota",
            )}
          </p>
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}
