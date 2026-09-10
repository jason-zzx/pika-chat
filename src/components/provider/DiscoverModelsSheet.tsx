"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { apiErrorMessage } from "@/lib/api/error-message";

import {
  useAddProviderModel,
  useDiscoverProviderModels,
} from "./use-provider-configs";

type DiscoverModelsSheetProps = {
  configId: string;
  configName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function DiscoverModelsSheet({
  configId,
  configName,
  open,
  onOpenChange,
}: DiscoverModelsSheetProps) {
  const discover = useDiscoverProviderModels();
  const addModel = useAddProviderModel();
  const t = useTranslations("Errors");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const modelIds = discover.data?.modelIds ?? [];

  async function onDiscover() {
    setError(null);
    try {
      await discover.mutateAsync(configId);
    } catch (caught) {
      setError(apiErrorMessage(caught, t, "actions.discoverModels"));
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
    } catch (caught) {
      setError(apiErrorMessage(caught, t, "actions.addModel"));
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add models</SheetTitle>
          <SheetDescription>
            Discover ids from {configName}, or type one on the provider card.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4">
          <Button
            type="button"
            variant="outline"
            disabled={discover.isPending}
            onClick={() => void onDiscover()}
          >
            {discover.isPending ? "Discovering…" : "Discover from endpoint"}
          </Button>
          {modelIds.length > 0 ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Served models</legend>
              {modelIds.map((modelId) => (
                <Label key={modelId} className="font-normal">
                  <input
                    type="checkbox"
                    checked={selected.has(modelId)}
                    onChange={(event) =>
                      toggle(modelId, event.currentTarget.checked)
                    }
                    className="size-4 accent-primary"
                  />
                  {modelId}
                </Label>
              ))}
              <Button
                type="button"
                disabled={selected.size === 0 || addModel.isPending}
                onClick={() => void onAddSelected()}
              >
                Add selected
              </Button>
            </fieldset>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
