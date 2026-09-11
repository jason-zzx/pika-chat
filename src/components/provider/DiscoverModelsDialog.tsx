"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { CheckIcon } from "lucide-react";

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
import { cn } from "@/lib/utils";

import {
  useAddProviderModel,
  useDiscoverProviderModels,
} from "./use-provider-configs";

type DiscoverModelsDialogProps = {
  configId: string;
  configName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function DiscoverModelsDialog({
  configId,
  configName,
  open,
  onOpenChange,
}: DiscoverModelsDialogProps) {
  const discover = useDiscoverProviderModels();
  const addModel = useAddProviderModel();
  const t = useTranslations("Provider");
  const tErrors = useTranslations("Errors");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const modelIds = discover.data?.modelIds ?? [];

  async function onDiscover() {
    setError(null);
    try {
      await discover.mutateAsync(configId);
    } catch (caught) {
      setError(apiErrorMessage(caught, tErrors, "actions.discoverModels"));
    }
  }

  function toggle(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  async function onAddSelected() {
    setError(null);
    try {
      for (const modelId of selected) {
        await addModel.mutateAsync({ configId, input: { modelId } });
      }
      setSelected(new Set());
      onOpenChange(false);
    } catch (caught) {
      setError(apiErrorMessage(caught, tErrors, "actions.addModel"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("addModelsTitle")}</DialogTitle>
          <DialogDescription>
            {t("addModelsDescription", { configName })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            disabled={discover.isPending}
            onClick={() => void onDiscover()}
          >
            {discover.isPending
              ? t("discovering")
              : t("discoverFromEndpoint")}
          </Button>

          {modelIds.length > 0 ? (
            <fieldset className="flex min-h-0 flex-col gap-2">
              <legend className="text-sm font-medium">
                {t("servedModels")}
              </legend>
              <ul className="thin-scrollbar flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">
                {modelIds.map((modelId) => {
                  const checked = selected.has(modelId);
                  return (
                    <li key={modelId}>
                      <button
                        type="button"
                        aria-pressed={checked}
                        onClick={() => toggle(modelId, !checked)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                          checked
                            ? "border-primary/60 bg-primary/10"
                            : "border-border hover:bg-muted",
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded-sm border transition-colors",
                            checked
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input bg-background text-transparent",
                          )}
                        >
                          <CheckIcon className="size-3.5" strokeWidth={3} />
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {modelId}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        {modelIds.length > 0 ? (
          <DialogFooter>
            <Button
              type="button"
              disabled={selected.size === 0 || addModel.isPending}
              onClick={() => void onAddSelected()}
            >
              {addModel.isPending
                ? t("saving")
                : t("addSelectedCount", { count: selected.size })}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
