"use client";

import { useState } from "react";

import EmptyState from "@/components/common/EmptyState";
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
  const [error, setError] = useState<string | null>(null);
  const loading = (
    <p className="text-sm text-muted-foreground">Loading…</p>
  );

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Add a provider</h2>
        <ProviderConfigForm
          idPrefix="create-provider"
          canShare={canShare}
          pending={createConfig.isPending}
          submitLabel="Create"
          onSubmit={async (input) => {
            setError(null);
            await createConfig.mutateAsync(input);
          }}
        />
      </section>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {configs.error ? (
        <p className="text-sm text-destructive">
          {apiErrorMessage(configs.error, "Unable to load providers")}
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Your providers</h2>
        {configs.isPending ? (
          loading
        ) : (configs.data?.own.length ?? 0) === 0 ? (
          <EmptyState
            title="No providers yet"
            description="Add an OpenAI-compatible endpoint to start choosing models."
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
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Shared with the instance</h2>
        {configs.isPending ? (
          loading
        ) : (configs.data?.shared.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">
            No shared providers yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {(configs.data?.shared ?? []).map((config) => (
              <li key={config.id}>
                <SharedProviderCard config={config} />
              </li>
            ))}
          </ul>
        )}
      </section>
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
  const [editing, setEditing] = useState(false);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<ProviderModel | null>(
    null,
  );
  const [manualId, setManualId] = useState("");

  return (
    <article className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="text-sm">
          <p className="font-medium">{config.name}</p>
          <p className="break-all text-muted-foreground">{config.baseUrl}</p>
          <p className="text-muted-foreground">
            {config.visibility}
            {config.apiKeyLastFour
              ? ` · key …${config.apiKeyLastFour}`
              : " · no API key"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? "Close" : "Edit"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDiscoverOpen(true)}
          >
            Discover
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={deleteConfig.isPending}
            onClick={() => {
              onError(null);
              void deleteConfig.mutateAsync(config.id).catch((caught) => {
                onError(apiErrorMessage(caught, "Unable to delete provider"));
              });
            }}
          >
            Delete
          </Button>
        </div>
      </div>

      {editing ? (
        <ProviderConfigForm
          idPrefix={`edit-${config.id}`}
          canShare={canShare}
          pending={updateConfig.isPending}
          submitLabel="Save"
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
        <p className="text-sm font-medium">Models</p>
        {config.models.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            None yet. Discover from the endpoint or type an id.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {config.models.map((model) => (
              <li
                key={model.id}
                className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-sm"
              >
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-1.5"
                  aria-label={`Edit ${model.modelId}`}
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
                  aria-label={`Remove ${model.modelId}`}
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
                          apiErrorMessage(caught, "Unable to remove model"),
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
                onError(apiErrorMessage(caught, "Unable to add model"));
              });
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Label htmlFor={`quick-model-${config.id}`}>Add model id</Label>
            <Input
              id={`quick-model-${config.id}`}
              value={manualId}
              onChange={(event) => setManualId(event.currentTarget.value)}
              placeholder="gpt-4o"
            />
          </div>
          <Button type="submit" size="sm" disabled={addModel.isPending}>
            Add
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
    </article>
  );
}

function SharedProviderCard({ config }: { config: SharedProviderConfig }) {
  return (
    <article className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="text-sm">
        <p className="font-medium">{config.name}</p>
        <p className="text-muted-foreground">Shared by {config.ownerName}</p>
      </div>
      {config.models.length === 0 ? (
        <p className="text-sm text-muted-foreground">No models</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {config.models.map((model) => (
            <li
              key={model.id}
              className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-sm"
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
    </article>
  );
}
