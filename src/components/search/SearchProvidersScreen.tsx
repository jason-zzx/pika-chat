"use client";

import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

import EmptyState from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
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
  const t = useTranslations("Errors");
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
          setError(apiErrorMessage(caught, t, "actions.reorderProviders"));
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
            t,
            "actions.loadSearchProviders",
          )}
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Fallback order</h2>
        <p className="text-sm text-muted-foreground">
          When the model asks to search the web, providers are tried top to
          bottom; the first one that responds wins.
        </p>
        {providers.isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : configured.length === 0 ? (
          <EmptyState
            title="No search providers yet"
            description="Add an API key below to enable app-side web search."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {configured.map((setting, index) => (
              <li key={setting.provider}>
                <ConfiguredProviderCard
                  setting={setting}
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
      </section>

      {!providers.isPending && unconfigured.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Add a provider</h2>
          <ul className="flex flex-col gap-3">
            {unconfigured.map((provider) => (
              <li key={provider}>
                <NewProviderCard provider={provider} onError={setError} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

type ProviderFormProps = {
  provider: SearchProvider;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  apiKeyPlaceholder?: string;
  baseUrl: string;
  onBaseUrlChange: (value: string) => void;
  pending: boolean;
  submitDisabled: boolean;
  submitLabel: string;
  onSubmit: () => Promise<void>;
  onError: (message: string | null) => void;
};

function ProviderForm({
  provider,
  apiKey,
  onApiKeyChange,
  apiKeyPlaceholder,
  baseUrl,
  onBaseUrlChange,
  pending,
  submitDisabled,
  submitLabel,
  onSubmit,
  onError,
}: ProviderFormProps) {
  const meta = SEARCH_PROVIDER_META[provider];
  const t = useTranslations("Errors");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);
    try {
      await onSubmit();
    } catch (caught) {
      onError(apiErrorMessage(caught, t, "actions.saveSearchProvider"));
    }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => void handleSubmit(event)}>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${provider}-api-key`}>API key</Label>
        <Input
          id={`${provider}-api-key`}
          type="password"
          autoComplete="off"
          placeholder={apiKeyPlaceholder}
          value={apiKey}
          onChange={(event) => onApiKeyChange(event.currentTarget.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${provider}-base-url`}>Base URL (optional)</Label>
        <Input
          id={`${provider}-base-url`}
          type="url"
          autoComplete="off"
          placeholder={meta.defaultBaseUrl}
          value={baseUrl}
          onChange={(event) => onBaseUrlChange(event.currentTarget.value)}
        />
      </div>
      <div>
        <Button type="submit" size="sm" disabled={pending || submitDisabled}>
          {submitLabel}
        </Button>
      </div>
    </form>
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
  canMoveUp,
  canMoveDown,
  onMove,
  onError,
}: {
  setting: SearchProviderSetting;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: -1 | 1) => void;
  onError: (message: string | null) => void;
}) {
  const meta = SEARCH_PROVIDER_META[setting.provider];
  const upsert = useUpsertSearchProvider();
  const remove = useDeleteSearchProvider();
  const t = useTranslations("Errors");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(setting.baseUrl ?? "");

  return (
    <article className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{meta.label}</p>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Move ${meta.label} up`}
            disabled={!canMoveUp}
            onClick={() => onMove(-1)}
          >
            <ChevronUpIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Move ${meta.label} down`}
            disabled={!canMoveDown}
            onClick={() => onMove(1)}
          >
            <ChevronDownIcon aria-hidden="true" />
          </Button>
        </div>
      </div>
      <ProviderForm
        provider={setting.provider}
        apiKey={apiKey}
        onApiKeyChange={setApiKey}
        apiKeyPlaceholder={`····${setting.apiKeyLastFour}`}
        baseUrl={baseUrl}
        onBaseUrlChange={setBaseUrl}
        pending={upsert.isPending}
        submitDisabled={false}
        submitLabel="Save"
        onSubmit={async () => {
          await upsert.mutateAsync({
            provider: setting.provider,
            input: buildUpsertInput(apiKey, baseUrl),
          });
          setApiKey("");
        }}
        onError={onError}
      />
      <p className="text-xs text-muted-foreground">
        Leave the API key field empty to keep the saved key.
      </p>
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={remove.isPending}
          onClick={() => {
            onError(null);
            remove.mutate(setting.provider, {
              onError: (caught) => {
                onError(apiErrorMessage(caught, t, "actions.deleteSearchProvider"));
              },
            });
          }}
        >
          Delete
        </Button>
      </div>
    </article>
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
  const upsert = useUpsertSearchProvider();
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  return (
    <article className="flex flex-col gap-3 rounded-md border border-border p-3">
      <p className="text-sm font-medium">{meta.label}</p>
      <ProviderForm
        provider={provider}
        apiKey={apiKey}
        onApiKeyChange={setApiKey}
        baseUrl={baseUrl}
        onBaseUrlChange={setBaseUrl}
        pending={upsert.isPending}
        submitDisabled={apiKey.trim().length === 0}
        submitLabel="Add"
        onSubmit={async () => {
          await upsert.mutateAsync({
            provider,
            input: buildUpsertInput(apiKey, baseUrl),
          });
        }}
        onError={onError}
      />
    </article>
  );
}
