"use client";

import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

import EmptyState from "@/components/common/EmptyState";
import SettingsCard from "@/components/settings/SettingsCard";
import SettingsSection from "@/components/settings/SettingsSection";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorMessage } from "@/lib/api/error-message";
import {
  SEARCH_PROVIDERS,
  type SearchProvider,
  type SearchProviderSetting,
  type UpsertSearchProviderInput,
} from "@/lib/schemas/search-provider";

import { SEARCH_PROVIDER_META } from "./provider-meta";
import {
  useDeleteSearchProvider,
  useReorderSearchProviders,
  useSearchProviders,
  useUpsertSearchProvider,
} from "./use-search-providers";

export default function SearchProvidersScreen() {
  const providers = useSearchProviders();
  const reorder = useReorderSearchProviders();
  const t = useTranslations("Search");
  const tErrors = useTranslations("Errors");
  const [error, setError] = useState<string | null>(null);

  const configured = providers.data?.providers ?? [];
  const configuredNames = new Set(configured.map((row) => row.provider));
  const unconfigured = SEARCH_PROVIDERS.filter(
    (provider) => !configuredNames.has(provider),
  );

  function handleMove(provider: SearchProvider, direction: -1 | 1) {
    const order = configured.map((row) => row.provider);
    const from = order.indexOf(provider);
    const moving = order[from];
    const swappedWith = order[from + direction];
    if (moving === undefined || swappedWith === undefined) {
      return;
    }
    const next = [...order];
    next[from] = swappedWith;
    next[from + direction] = moving;
    setError(null);
    reorder.mutate(
      { providers: next },
      {
        onError: (caught) => {
          setError(apiErrorMessage(caught, tErrors, "actions.reorderProviders"));
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {providers.error ? (
        <p className="text-sm text-destructive" role="alert">
          {apiErrorMessage(
            providers.error,
            tErrors,
            "actions.loadSearchProviders",
          )}
        </p>
      ) : null}

      <SettingsSection
        title={t("fallbackOrderTitle")}
        description={t("fallbackOrderDescription")}
      >
        {providers.isPending ? (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        ) : configured.length === 0 ? (
          <EmptyState
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {configured.map((setting, index) => (
              <li key={setting.provider}>
                <ConfiguredProviderCard
                  setting={setting}
                  position={index + 1}
                  canMoveUp={index > 0 && !reorder.isPending}
                  canMoveDown={
                    index < configured.length - 1 && !reorder.isPending
                  }
                  onMove={(direction) => handleMove(setting.provider, direction)}
                  onError={setError}
                />
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      {!providers.isPending && unconfigured.length > 0 ? (
        <SettingsSection title={t("addProviderTitle")}>
          <ul className="flex flex-col gap-3">
            {unconfigured.map((provider) => (
              <li key={provider}>
                <NewProviderCard provider={provider} onError={setError} />
              </li>
            ))}
          </ul>
        </SettingsSection>
      ) : null}
    </div>
  );
}

function buildUpsertInput(
  apiKey: string,
  baseUrl: string,
): UpsertSearchProviderInput {
  const trimmedKey = apiKey.trim();
  const trimmedUrl = baseUrl.trim();
  return {
    // An empty key field on update keeps the stored key (PUT omits apiKey).
    ...(trimmedKey.length > 0 ? { apiKey: trimmedKey } : {}),
    baseUrl: trimmedUrl.length > 0 ? trimmedUrl : null,
  };
}

function ConfiguredProviderCard({
  setting,
  position,
  canMoveUp,
  canMoveDown,
  onMove,
  onError,
}: {
  setting: SearchProviderSetting;
  position: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: -1 | 1) => void;
  onError: (message: string | null) => void;
}) {
  const meta = SEARCH_PROVIDER_META[setting.provider];
  const remove = useDeleteSearchProvider();
  const t = useTranslations("Search");
  const tErrors = useTranslations("Errors");
  const [editOpen, setEditOpen] = useState(false);

  return (
    <SettingsCard className="flex items-center gap-3 p-4 sm:px-5">
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold tabular-nums text-muted-foreground"
      >
        {position}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-semibold tracking-tight">{meta.label}</p>
        <p className="truncate text-xs text-muted-foreground">
          {t("keyHint", { lastFour: setting.apiKeyLastFour })}
          {setting.baseUrl ? ` · ${setting.baseUrl}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("moveUp", { name: meta.label })}
          disabled={!canMoveUp}
          onClick={() => onMove(-1)}
        >
          <ChevronUpIcon aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("moveDown", { name: meta.label })}
          disabled={!canMoveDown}
          onClick={() => onMove(1)}
        >
          <ChevronDownIcon aria-hidden="true" />
        </Button>
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
          variant="outline"
          size="sm"
          disabled={remove.isPending}
          onClick={() => {
            onError(null);
            remove.mutate(setting.provider, {
              onError: (caught) => {
                onError(
                  apiErrorMessage(caught, tErrors, "actions.deleteSearchProvider"),
                );
              },
            });
          }}
        >
          {t("delete")}
        </Button>
      </div>
      <ProviderFormDialog
        provider={setting.provider}
        setting={setting}
        open={editOpen}
        onOpenChange={setEditOpen}
        onError={onError}
      />
    </SettingsCard>
  );
}

function NewProviderCard({
  provider,
  onError,
}: {
  provider: SearchProvider;
  onError: (message: string | null) => void;
}) {
  const meta = SEARCH_PROVIDER_META[provider];
  const t = useTranslations("Search");
  const [addOpen, setAddOpen] = useState(false);

  return (
    <SettingsCard className="flex items-center gap-3 p-4 sm:px-5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-semibold tracking-tight">{meta.label}</p>
        <p className="truncate text-xs text-muted-foreground">
          {meta.defaultBaseUrl}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={() => setAddOpen(true)}
      >
        {t("add")}
      </Button>
      <ProviderFormDialog
        provider={provider}
        setting={null}
        open={addOpen}
        onOpenChange={setAddOpen}
        onError={onError}
      />
    </SettingsCard>
  );
}

type ProviderFormDialogProps = {
  provider: SearchProvider;
  /** Null switches the dialog into add mode (a key is required). */
  setting: SearchProviderSetting | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onError: (message: string | null) => void;
};

function ProviderFormDialog({
  provider,
  setting,
  open,
  onOpenChange,
  onError,
}: ProviderFormDialogProps) {
  const meta = SEARCH_PROVIDER_META[provider];
  const upsert = useUpsertSearchProvider();
  const t = useTranslations("Search");
  const tErrors = useTranslations("Errors");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(setting?.baseUrl ?? "");
  const isEdit = setting !== null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);
    try {
      await upsert.mutateAsync({
        provider,
        input: buildUpsertInput(apiKey, baseUrl),
      });
      setApiKey("");
      onOpenChange(false);
    } catch (caught) {
      onError(apiErrorMessage(caught, tErrors, "actions.saveSearchProvider"));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setApiKey("");
          setBaseUrl(setting?.baseUrl ?? "");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? t("editProviderTitle", { name: meta.label })
              : t("addProviderNamedTitle", { name: meta.label })}
          </DialogTitle>
          {isEdit ? (
            <DialogDescription>{t("keepKeyHint")}</DialogDescription>
          ) : null}
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${provider}-api-key`}>{t("apiKeyLabel")}</Label>
            <Input
              id={`${provider}-api-key`}
              type="password"
              autoComplete="off"
              placeholder={
                isEdit ? `····${setting.apiKeyLastFour}` : undefined
              }
              value={apiKey}
              onChange={(event) => setApiKey(event.currentTarget.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${provider}-base-url`}>{t("baseUrlLabel")}</Label>
            <Input
              id={`${provider}-base-url`}
              type="url"
              autoComplete="off"
              placeholder={meta.defaultBaseUrl}
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.currentTarget.value)}
            />
          </div>
          <div>
            <Button
              type="submit"
              size="sm"
              disabled={
                upsert.isPending || (!isEdit && apiKey.trim().length === 0)
              }
            >
              {isEdit ? t("save") : t("add")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
