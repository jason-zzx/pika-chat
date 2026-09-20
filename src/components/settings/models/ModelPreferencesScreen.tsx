"use client";

import { useTranslations } from "next-intl";

import { pairFromIds } from "@/components/chat/model-pick";
import ModelPicker from "@/components/chat/ModelPicker";
import SettingsCard from "@/components/settings/SettingsCard";
import SettingsRow from "@/components/settings/SettingsRow";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  useModelPreferences,
  useUpdateModelPreferences,
} from "@/hooks/use-model-preferences";
import { apiErrorMessage } from "@/lib/api/error-message";
import type {
  ModelPreferencePurpose,
  ModelPreferences,
} from "@/lib/schemas/model-preferences";
import type { ComposerModelPick } from "@/stores/composer-store";

const ROWS: readonly {
  purpose: ModelPreferencePurpose;
  labelKey: "chat" | "titleGeneration" | "compression" | "translation";
  descriptionKey:
    | "chatDescription"
    | "titleGenerationDescription"
    | "compressionDescription"
    | "translationDescription";
}[] = [
  { purpose: "chat", labelKey: "chat", descriptionKey: "chatDescription" },
  {
    purpose: "title",
    labelKey: "titleGeneration",
    descriptionKey: "titleGenerationDescription",
  },
  {
    purpose: "compression",
    labelKey: "compression",
    descriptionKey: "compressionDescription",
  },
  {
    purpose: "translation",
    labelKey: "translation",
    descriptionKey: "translationDescription",
  },
];

export default function ModelPreferencesScreen() {
  const t = useTranslations("Settings.Models");
  const tErrors = useTranslations("Errors");
  const preferences = useModelPreferences();
  const update = useUpdateModelPreferences();

  function save(next: ModelPreferences) {
    update.mutate(next, {
      onError: (error) => {
        toast.add({
          type: "error",
          title: apiErrorMessage(error, tErrors, "actions.saveDefaultModel"),
        });
      },
    });
  }

  function handleChange(purpose: ModelPreferencePurpose, pick: ComposerModelPick | null) {
    save({
      ...(preferences.data ?? {}),
      [purpose]: pick
        ? { providerConfigId: pick.configId, modelId: pick.modelId }
        : null,
    });
  }

  return (
    <>
      <SettingsCard>
        <div className="flex flex-col divide-y divide-border">
          {ROWS.map((row) => (
            <SettingsRow
              key={row.purpose}
              label={t(row.labelKey)}
              description={t(row.descriptionKey)}
              control={
                <ModelPicker
                  value={pairFromIds(
                    preferences.data?.[row.purpose]?.providerConfigId,
                    preferences.data?.[row.purpose]?.modelId,
                  )}
                  onChange={(pick) => handleChange(row.purpose, pick)}
                  allowClear
                  disabled={preferences.isPending}
                />
              }
            />
          ))}
        </div>
      </SettingsCard>
      <div className="mt-4 flex justify-end">
        <Button
          type="button"
          variant="outline"
          disabled={preferences.isPending || update.isPending}
          onClick={() => save({})}
        >
          {t("resetAll")}
        </Button>
      </div>
    </>
  );
}
