"use client";

import { ArrowLeftIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import EmptyState from "@/components/common/EmptyState";
import SettingsBadge from "@/components/settings/SettingsBadge";
import SettingsCard from "@/components/settings/SettingsCard";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiErrorMessage } from "@/lib/api/error-message";
import type {
  OwnProviderConfig,
  ProviderModel,
  SharedProviderConfig,
} from "@/lib/schemas/provider";
import { cn } from "@/lib/utils";

import DiscoverModelsDialog from "./DiscoverModelsDialog";
import ModelEditorDialog from "./ModelEditorDialog";
import ModelVendorIcon from "./ModelVendorIcon";
import { ModelCapabilityIcons } from "./model-capabilities";
import ProviderConfigForm, {
  PROVIDER_FORMAT_LABEL_KEYS,
} from "./ProviderConfigForm";
import {
  useCreateProviderConfig,
  useDeleteProviderConfig,
  useProviderConfigs,
  useRemoveProviderModel,
  useUpdateProviderConfig,
} from "./use-provider-configs";

/** Compact token count for model rows: 256000 → "256K", 1000000 → "1M". */
function formatTokensShort(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${Math.round(tokens / 100_000) / 10}M`;
  }
  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}K`;
  }
  return String(tokens);
}

type ProviderConfigsScreenProps = {
  canShare: boolean;
  /** Present when rendered on the /settings/providers/[configId] route —
      on mobile that route shows the detail pane only (sub-page), while
      desktop keeps the master-detail layout with this entry selected. */
  selectedConfigId?: string;
};

export default function ProviderConfigsScreen({
  canShare,
  selectedConfigId,
}: ProviderConfigsScreenProps) {
  const configs = useProviderConfigs();
  const createConfig = useCreateProviderConfig();
  const router = useRouter();
  const t = useTranslations("Provider");
  const tErrors = useTranslations("Errors");
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(
    selectedConfigId ?? null,
  );

  const own = configs.data?.own ?? [];
  const shared = configs.data?.shared ?? [];
  // Fall back to the first entry when nothing (valid) is selected, so the
  // detail pane is never blank while providers exist. On the [configId]
  // route an unknown id intentionally shows the hint instead.
  const selectedOwn = own.find((config) => config.id === selectedId);
  const selectedShared = shared.find((config) => config.id === selectedId);
  const selected = selectedOwn ?? selectedShared ?? null;
  const detail =
    selected ?? (selectedConfigId ? null : (own[0] ?? shared[0] ?? null));

  function handleSelect(id: string) {
    setSelectedId(id);
    // Mobile navigates to the detail sub-page; desktop swaps in place.
    if (
      typeof window.matchMedia !== "function" ||
      !window.matchMedia("(min-width: 768px)").matches
    ) {
      router.push(`/settings/providers/${id}`);
    }
  }

  function handleDeleted(id: string) {
    if (selectedId === id) {
      setSelectedId(null);
    }
    if (selectedConfigId === id) {
      router.push("/settings/providers");
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 md:min-h-0">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {configs.error ? (
        <p className="text-sm text-destructive">
          {apiErrorMessage(configs.error, tErrors, "actions.loadProviders")}
        </p>
      ) : null}

      <div className="relative grid gap-6 md:min-h-0 md:flex-1 md:grid-cols-[260px_minmax(0,1fr)] md:gap-8">
        {/* Full-height divider: the stretched grid (flex-1) fills the
            container's content area, so inset-y-0 spans it top to bottom
            without bleeding into the container's bottom padding
            (260px sidebar column + half of the 2rem gap). */}
        <div
          aria-hidden="true"
          className="absolute inset-y-0 left-[276px] hidden border-l border-border md:block"
        />
        <div
          className={cn(
            "flex-col gap-4 md:min-h-0",
            selectedConfigId ? "hidden md:flex" : "flex",
          )}
        >
          <Button
            type="button"
            className="w-full"
            onClick={() => setCreateOpen(true)}
          >
            <PlusIcon aria-hidden="true" />
            {t("addProviderTitle")}
          </Button>

          {configs.isPending ? (
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          ) : own.length === 0 && shared.length === 0 ? (
            <EmptyState
              title={t("emptyTitle")}
              description={t("emptyDescription")}
            />
          ) : (
            <nav className="thin-scrollbar flex flex-col gap-4 md:min-h-0 md:flex-1 md:overflow-y-auto">
              {own.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <p className="px-2 text-xs font-medium text-muted-foreground">
                    {t("yourProvidersTitle")}
                  </p>
                  <ul className="flex flex-col gap-0.5">
                    {own.map((config) => (
                      <li key={config.id}>
                        <ProviderListItem
                          name={config.name}
                          models={config.models}
                          active={detail?.id === config.id}
                          onSelect={() => handleSelect(config.id)}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {shared.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <p className="px-2 text-xs font-medium text-muted-foreground">
                    {t("sharedTitle")}
                  </p>
                  <ul className="flex flex-col gap-0.5">
                    {shared.map((config) => (
                      <li key={config.id}>
                        <ProviderListItem
                          name={config.name}
                          models={config.models}
                          active={detail?.id === config.id}
                          onSelect={() => handleSelect(config.id)}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </nav>
          )}
        </div>

        <div
          className={cn(
            "min-w-0 md:min-h-0 md:overflow-y-auto",
            selectedConfigId ? "block" : "hidden md:block",
          )}
        >
          {selectedConfigId ? (
            <Link
              href="/settings/providers"
              className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground md:hidden"
            >
              <ArrowLeftIcon aria-hidden="true" className="size-4" />
              {t("backToProviders")}
            </Link>
          ) : null}
          {detail === null ? (
            <p className="text-sm text-muted-foreground">
              {t("selectProviderHint")}
            </p>
          ) : "ownerName" in detail ? (
            <SharedProviderDetail config={detail} />
          ) : (
            <OwnProviderDetail
              key={detail.id}
              config={detail}
              canShare={canShare}
              onError={setError}
              onDeleted={handleDeleted}
            />
          )}
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("addProviderTitle")}</DialogTitle>
            <DialogDescription>
              {t("addProviderDescription")}
            </DialogDescription>
          </DialogHeader>
          <ProviderConfigForm
            idPrefix="create-provider"
            canShare={canShare}
            pending={createConfig.isPending}
            submitLabel={t("create")}
            onSubmit={async (input) => {
              setError(null);
              await createConfig.mutateAsync(input);
              setCreateOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProviderListItem({
  name,
  models,
  active,
  onSelect,
}: {
  name: string;
  models: ProviderModel[];
  active: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations("Provider");
  const firstModel = models[0];
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
        active
          ? "bg-accent font-medium text-accent-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <ModelVendorIcon
        modelId={firstModel?.modelId ?? ""}
        vendorKey={firstModel?.vendorKey ?? null}
      />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {t("modelCount", { count: models.length })}
      </span>
    </button>
  );
}

function OwnProviderDetail({
  config,
  canShare,
  onError,
  onDeleted,
}: {
  config: OwnProviderConfig;
  canShare: boolean;
  onError: (message: string | null) => void;
  onDeleted: (id: string) => void;
}) {
  const updateConfig = useUpdateProviderConfig();
  const deleteConfig = useDeleteProviderConfig();
  const removeModel = useRemoveProviderModel();
  const t = useTranslations("Provider");
  const tErrors = useTranslations("Errors");
  const [editOpen, setEditOpen] = useState(false);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [addModelOpen, setAddModelOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<ProviderModel | null>(
    null,
  );
  const visibilityLabel =
    config.visibility === "shared"
      ? t("visibilityShared")
      : t("visibilityPrivate");

  return (
    <SettingsCard className="flex flex-col gap-5 p-4 sm:p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-semibold tracking-tight">
              {config.name}
            </p>
            <SettingsBadge dot={false}>{visibilityLabel}</SettingsBadge>
            <SettingsBadge dot={false}>
              {t(PROVIDER_FORMAT_LABEL_KEYS[config.apiFormat])}
            </SettingsBadge>
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
            onClick={() => setEditOpen(true)}
          >
            {t("edit")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => setDeleteConfirmOpen(true)}
          >
            {t("delete")}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{t("models")}</p>
          <div className="flex flex-wrap gap-2">
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
              size="sm"
              onClick={() => setAddModelOpen(true)}
            >
              <PlusIcon aria-hidden="true" />
              {t("addModel")}
            </Button>
          </div>
        </div>
        {config.models.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noModelsHint")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {config.models.map((model) => (
              <li
                key={model.id}
                className="relative flex items-center gap-2.5 rounded-lg border border-border px-3 py-2 transition-colors hover:bg-muted/50"
              >
                {/* Full-row edit target: the overlay button covers the entire
                    row so clicks anywhere open the editor; the remove button
                    stays above it. */}
                <button
                  type="button"
                  className="absolute inset-0 rounded-lg"
                  aria-label={t("editModel", { modelId: model.modelId })}
                  onClick={() => setEditingModel(model)}
                />
                <ModelVendorIcon
                  modelId={model.modelId}
                  vendorKey={model.vendorKey}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {model.modelId}
                </span>
                <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline">
                  {formatTokensShort(model.contextTokens)}
                </span>
                <ModelCapabilityIcons model={model} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="relative"
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
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("editProviderTitle")}</DialogTitle>
          </DialogHeader>
          <ProviderConfigForm
            idPrefix={`edit-${config.id}`}
            canShare={canShare}
            pending={updateConfig.isPending}
            submitLabel={t("save")}
            initial={{
              name: config.name,
              baseUrl: config.baseUrl,
              apiFormat: config.apiFormat,
              visibility: config.visibility,
            }}
            onSubmit={async (input) => {
              onError(null);
              await updateConfig.mutateAsync({
                id: config.id,
                input,
              });
              setEditOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>

      <DiscoverModelsDialog
        configId={config.id}
        configName={config.name}
        open={discoverOpen}
        onOpenChange={setDiscoverOpen}
      />
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("deleteProviderTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteProviderDescription", { name: config.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteConfig.isPending}
              onClick={() => {
                onError(null);
                void deleteConfig
                  .mutateAsync(config.id)
                  .then(() => {
                    setDeleteConfirmOpen(false);
                    onDeleted(config.id);
                  })
                  .catch((caught) => {
                    onError(
                      apiErrorMessage(
                        caught,
                        tErrors,
                        "actions.deleteProvider",
                      ),
                    );
                  });
              }}
            >
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {addModelOpen ? (
        <ModelEditorDialog
          open
          onOpenChange={(next) => {
            if (!next) {
              setAddModelOpen(false);
            }
          }}
          configId={config.id}
        />
      ) : null}
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

function SharedProviderDetail({ config }: { config: SharedProviderConfig }) {
  const t = useTranslations("Provider");
  return (
    <SettingsCard className="flex flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-base font-semibold tracking-tight">
            {config.name}
          </p>
          <SettingsBadge dot={false}>{t("visibilityShared")}</SettingsBadge>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("sharedBy", { name: config.ownerName })}
        </p>
      </div>
      {config.models.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noModels")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {config.models.map((model) => (
            <li
              key={model.id}
              className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2"
            >
              <ModelVendorIcon
                modelId={model.modelId}
                vendorKey={model.vendorKey}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {model.modelId}
              </span>
              <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline">
                {formatTokensShort(model.contextTokens)}
              </span>
              <ModelCapabilityIcons model={model} />
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}
