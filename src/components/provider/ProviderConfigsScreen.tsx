"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import EmptyState from "@/components/common/EmptyState";
import SettingsBadge from "@/components/settings/SettingsBadge";
import SettingsCard from "@/components/settings/SettingsCard";
import SettingsSection from "@/components/settings/SettingsSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorMessage } from "@/lib/api/error-message";
import type {
  OwnProviderConfig,
  ProviderModel,
  SharedProviderConfig,
} from "@/lib/schemas/provider";

import DiscoverModelsSheet from "./DiscoverModelsSheet";
import ModelEditorDialog from "./ModelEditorDialog";
import ModelVendorIcon from "./ModelVendorIcon";
import ProviderConfigForm from "./ProviderConfigForm";
import {
  useAddProviderModel,
  useCreateProviderConfig,
  useDeleteProviderConfig,
  useProviderConfigs,
  useRemoveProviderModel,
  useUpdateProviderConfig,
} from "./use-provider-configs";

type ProviderConfigsScreenProps = {
  canShare: boolean;
};

export default function ProviderConfigsScreen({
  canShare,
}: ProviderConfigsScreenProps) {
  const configs = useProviderConfigs();
  const createConfig = useCreateProviderConfig();
  const t = useTranslations("Provider");
  const tErrors = useTranslations("Errors");
  const [error, setError] = useState<string | null>(null);
  const loading = (
    <p className="text-sm text-muted-foreground">{t("loading")}</p>
  );

  return (
    <div className="flex flex-col gap-8">
      <SettingsSection title={t("addProviderTitle")}>
        <SettingsCard className="p-5">
          <ProviderConfigForm
            idPrefix="create-provider"
            canShare={canShare}
            pending={createConfig.isPending}
            submitLabel={t("create")}
            onSubmit={async (input) => {
              setError(null);
              await createConfig.mutateAsync(input);
            }}
          />
        </SettingsCard>
      </SettingsSection>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {configs.error ? (
        <p className="text-sm text-destructive">
          {apiErrorMessage(configs.error, tErrors, "actions.loadProviders")}
        </p>
      ) : null}

      <SettingsSection title={t("yourProvidersTitle")}>
        {configs.isPending ? (
          loading
        ) : (configs.data?.own.length ?? 0) === 0 ? (
          <EmptyState
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {(configs.data?.own ?? []).map((config) => (
              <li key={config.id}>
                <OwnProviderCard
                  config={config}
                  canShare={canShare}
                  onError={setError}
                />
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      <SettingsSection title={t("sharedTitle")}>
        {configs.isPending ? (
          loading
        ) : (configs.data?.shared.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noShared")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {(configs.data?.shared ?? []).map((config) => (
              <li key={config.id}>
                <SharedProviderCard config={config} />
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>
    </div>
  );
}

function OwnProviderCard({
  config,
  canShare,
  onError,
}: {
  config: OwnProviderConfig;
  canShare: boolean;
  onError: (message: string | null) => void;
}) {
  const updateConfig = useUpdateProviderConfig();
  const deleteConfig = useDeleteProviderConfig();
  const addModel = useAddProviderModel();
  const removeModel = useRemoveProviderModel();
  const t = useTranslations("Provider");
  const tCommon = useTranslations("Common");
  const tErrors = useTranslations("Errors");
  const [editing, setEditing] = useState(false);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<ProviderModel | null>(
    null,
  );
  const [manualId, setManualId] = useState("");
  const visibilityLabel =
    config.visibility === "shared"
      ? t("visibilityShared")
      : t("visibilityPrivate");

  return (
    <SettingsCard className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-semibold tracking-tight">
              {config.name}
            </p>
            <SettingsBadge dot={false}>{visibilityLabel}</SettingsBadge>
          </div>
          <p className="break-all text-sm text-muted-foreground">
            {config.baseUrl}
          </p>
          <p className="text-xs text-muted-foreground">
            {config.apiKeyLastFour
              ? t("keyHint", { lastFour: config.apiKeyLastFour })
              : t("noKeyHint")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? tCommon("close") : t("edit")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDiscoverOpen(true)}
          >
            {t("discover")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={deleteConfig.isPending}
            onClick={() => {
              onError(null);
              void deleteConfig.mutateAsync(config.id).catch((caught) => {
                onError(
                  apiErrorMessage(caught, tErrors, "actions.deleteProvider"),
                );
              });
            }}
          >
            {t("delete")}
          </Button>
        </div>
      </div>

      {editing ? (
        <ProviderConfigForm
          idPrefix={`edit-${config.id}`}
          canShare={canShare}
          pending={updateConfig.isPending}
          submitLabel={t("save")}
          initial={{
            name: config.name,
            baseUrl: config.baseUrl,
            visibility: config.visibility,
          }}
          onSubmit={async (input) => {
            onError(null);
            await updateConfig.mutateAsync({
              id: config.id,
              input,
            });
            setEditing(false);
          }}
        />
      ) : null}

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{t("models")}</p>
        {config.models.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noModelsHint")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {config.models.map((model) => (
              <li
                key={model.id}
                className="flex items-center gap-1 rounded-full bg-muted py-1 pl-3 pr-1 text-sm"
              >
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-1.5"
                  aria-label={t("editModel", { modelId: model.modelId })}
                  onClick={() => setEditingModel(model)}
                >
                  <ModelVendorIcon
                    modelId={model.modelId}
                    vendorKey={model.vendorKey}
                  />
                  <span className="truncate">{model.modelId}</span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("removeModel", { modelId: model.modelId })}
                  disabled={removeModel.isPending}
                  onClick={() => {
                    onError(null);
                    void removeModel
                      .mutateAsync({
                        configId: config.id,
                        modelId: model.modelId,
                      })
                      .catch((caught) => {
                        onError(
                          apiErrorMessage(
                            caught,
                            tErrors,
                            "actions.removeModel",
                          ),
                        );
                      });
                  }}
                >
                  ×
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            const modelId = manualId.trim();
            if (!modelId) {
              return;
            }
            onError(null);
            void addModel
              .mutateAsync({ configId: config.id, input: { modelId } })
              .then(() => setManualId(""))
              .catch((caught) => {
                onError(apiErrorMessage(caught, tErrors, "actions.addModel"));
              });
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Label htmlFor={`quick-model-${config.id}`}>{t("addModelId")}</Label>
            <Input
              id={`quick-model-${config.id}`}
              value={manualId}
              onChange={(event) => setManualId(event.currentTarget.value)}
              placeholder={t("modelIdPlaceholder")}
            />
          </div>
          <Button type="submit" size="sm" disabled={addModel.isPending}>
            {t("add")}
          </Button>
        </form>
      </div>

      <DiscoverModelsSheet
        configId={config.id}
        configName={config.name}
        open={discoverOpen}
        onOpenChange={setDiscoverOpen}
      />
      {editingModel ? (
        <ModelEditorDialog
          key={editingModel.id}
          open
          onOpenChange={(next) => {
            if (!next) {
              setEditingModel(null);
            }
          }}
          configId={config.id}
          model={editingModel}
        />
      ) : null}
    </SettingsCard>
  );
}

function SharedProviderCard({ config }: { config: SharedProviderConfig }) {
  const t = useTranslations("Provider");
  return (
    <SettingsCard className="flex flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold tracking-tight">{config.name}</p>
        <p className="text-sm text-muted-foreground">
          {t("sharedBy", { name: config.ownerName })}
        </p>
      </div>
      {config.models.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noModels")}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {config.models.map((model) => (
            <li
              key={model.id}
              className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-sm"
            >
              <ModelVendorIcon
                modelId={model.modelId}
                vendorKey={model.vendorKey}
              />
              {model.modelId}
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}
