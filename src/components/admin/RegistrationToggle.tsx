"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import SettingsBadge from "@/components/settings/SettingsBadge";
import SettingsCard from "@/components/settings/SettingsCard";
import SettingsSection from "@/components/settings/SettingsSection";
import { Button } from "@/components/ui/button";
import {
  fetchInstanceState,
  updateInstanceSettings,
} from "@/lib/api/instance";

export default function RegistrationToggle() {
  const queryClient = useQueryClient();
  const t = useTranslations("Admin");
  const settings = useQuery({
    queryKey: ["instance"],
    queryFn: fetchInstanceState,
  });
  const mutation = useMutation({
    mutationFn: updateInstanceSettings,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["instance"] });
    },
  });

  const allowRegistration = settings.data?.allowRegistration ?? false;
  const statusTone: "success" | "neutral" = allowRegistration
    ? "success"
    : "neutral";

  return (
    <SettingsSection title={t("registrationTitle")}>
      <SettingsCard>
        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1.5">
            <SettingsBadge tone={statusTone}>
              {allowRegistration
                ? t("registrationStatusOpen")
                : t("registrationStatusClosed")}
            </SettingsBadge>
            <p className="text-sm text-muted-foreground">
              {allowRegistration
                ? t("registrationOpen")
                : t("registrationClosed")}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit shrink-0"
            disabled={settings.isPending || mutation.isPending}
            onClick={() => {
              mutation.mutate({ allowRegistration: !allowRegistration });
            }}
          >
            {allowRegistration
              ? t("disableRegistration")
              : t("enableRegistration")}
          </Button>
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}
