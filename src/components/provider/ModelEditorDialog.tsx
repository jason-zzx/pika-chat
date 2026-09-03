"use client";

import { useState, type FormEvent } from "react";

import ModelVendorIcon from "@/components/provider/ModelVendorIcon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiErrorMessage } from "@/lib/api/error-message";
import {
  isModelVendorKey,
  MODEL_VENDOR_KEYS,
  MODEL_VENDOR_LABELS,
} from "@/lib/model-vendor";
import {
  isReasoningEffortChoice,
  REASONING_EFFORT_CHOICES,
  SEEDED_REASONING_OPTIONS,
  type ProviderModel,
  type ReasoningEffortChoice,
} from "@/lib/schemas/provider";

import { useUpdateProviderModel } from "./use-provider-configs";

const INPUT_MODALITIES = ["text", "image", "audio", "video", "pdf"] as const;

type ModelEditorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  configId: string;
  model: ProviderModel;
};

export default function ModelEditorDialog({
  open,
  onOpenChange,
  configId,
  model,
}: ModelEditorDialogProps) {
  const updateModel = useUpdateProviderModel();
  const [contextTokens, setContextTokens] = useState(
    String(model.contextTokens),
  );
  const [inputModalities, setInputModalities] = useState(
    new Set(model.inputModalities),
  );
  const [reasoning, setReasoning] = useState(model.reasoning);
  const [reasoningOptions, setReasoningOptions] = useState(
    () => new Set(model.reasoningOptions.filter(isReasoningEffortChoice)),
  );
  const [vendorKey, setVendorKey] = useState(model.vendorKey ?? "");
  const [error, setError] = useState<string | null>(null);

  function toggleModality(modality: string, checked: boolean) {
    setInputModalities((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(modality);
      } else {
        next.delete(modality);
      }
      return next;
    });
  }

  function toggleEffort(option: ReasoningEffortChoice, checked: boolean) {
    setReasoningOptions((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(option);
      } else {
        next.delete(option);
      }
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedContext = Number.parseInt(contextTokens, 10);
    if (!Number.isFinite(parsedContext) || parsedContext <= 0) {
      setError("Context size must be a positive number of tokens.");
      return;
    }
    const modalities = INPUT_MODALITIES.filter((modality) =>
      inputModalities.has(modality),
    );
    if (modalities.length === 0) {
      setError("Choose at least one input modality.");
      return;
    }
    const options = reasoning
      ? REASONING_EFFORT_CHOICES.filter((option) => reasoningOptions.has(option))
      : model.reasoningOptions;
    setError(null);
    try {
      await updateModel.mutateAsync({
        configId,
        modelId: model.modelId,
        input: {
          contextTokens: parsedContext,
          inputModalities: [...modalities],
          reasoning,
          reasoningOptions: reasoning
            ? options.length > 0
              ? options
              : [...SEEDED_REASONING_OPTIONS]
            : undefined,
          vendorKey: isModelVendorKey(vendorKey) ? vendorKey : null,
        },
      });
      onOpenChange(false);
    } catch (caught) {
      setError(apiErrorMessage(caught, "Unable to save model"));
    }
  }

  async function handleReset() {
    setError(null);
    try {
      const next = await updateModel.mutateAsync({
        configId,
        modelId: model.modelId,
        input: { resetFromCatalog: true },
      });
      setContextTokens(String(next.contextTokens));
      setInputModalities(new Set(next.inputModalities));
      setReasoning(next.reasoning);
      setReasoningOptions(
        new Set(next.reasoningOptions.filter(isReasoningEffortChoice)),
      );
      setVendorKey(next.vendorKey ?? "");
    } catch (caught) {
      setError(apiErrorMessage(caught, "Unable to reset from catalog"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ModelVendorIcon
                modelId={model.modelId}
                vendorKey={vendorKey.length > 0 ? vendorKey : model.vendorKey}
              />
              {model.modelId}
            </DialogTitle>
            <DialogDescription>
              Context, capabilities, and the developer icon for this model.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="model-context">Context tokens</Label>
              <Input
                id="model-context"
                inputMode="numeric"
                value={contextTokens}
                onChange={(event) =>
                  setContextTokens(event.currentTarget.value)
                }
              />
            </div>

            <fieldset className="flex flex-col gap-1">
              <legend className="text-sm font-medium">Input modalities</legend>
              <div className="flex flex-wrap gap-2">
                {INPUT_MODALITIES.map((modality) => (
                  <Label key={modality} className="gap-2 font-normal">
                    <input
                      type="checkbox"
                      checked={inputModalities.has(modality)}
                      onChange={(event) =>
                        toggleModality(modality, event.currentTarget.checked)
                      }
                      className="size-4 accent-primary"
                    />
                    {modality}
                  </Label>
                ))}
              </div>
            </fieldset>

            <Label className="gap-2 font-normal">
              <input
                type="checkbox"
                checked={reasoning}
                onChange={(event) => setReasoning(event.currentTarget.checked)}
                className="size-4 accent-primary"
              />
              Supports reasoning
            </Label>

            {reasoning ? (
              <fieldset className="flex flex-col gap-1">
                <legend className="text-sm font-medium">
                  Reasoning effort options
                </legend>
                <div className="flex flex-wrap gap-2">
                  {REASONING_EFFORT_CHOICES.map((option) => (
                    <Label key={option} className="gap-2 font-normal">
                      <input
                        type="checkbox"
                        checked={reasoningOptions.has(option)}
                        onChange={(event) =>
                          toggleEffort(option, event.currentTarget.checked)
                        }
                        className="size-4 accent-primary"
                      />
                      {option}
                    </Label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            <div className="flex flex-col gap-1">
              <Label htmlFor="model-vendor">Vendor icon</Label>
              <Select
                value={vendorKey.length > 0 ? vendorKey : "auto"}
                onValueChange={(next) => {
                  if (typeof next !== "string") {
                    return;
                  }
                  setVendorKey(next === "auto" ? "" : next);
                }}
              >
                <SelectTrigger id="model-vendor" className="w-full">
                  <SelectValue placeholder="Auto">
                    {isModelVendorKey(vendorKey)
                      ? MODEL_VENDOR_LABELS[vendorKey]
                      : "Auto"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  {MODEL_VENDOR_KEYS.map((key) => (
                    <SelectItem key={key} value={key}>
                      <span className="flex items-center gap-2">
                        <ModelVendorIcon modelId={model.modelId} vendorKey={key} />
                        {MODEL_VENDOR_LABELS[key]}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={updateModel.isPending}
              onClick={() => {
                void handleReset();
              }}
            >
              Reset from catalog
            </Button>
            <Button type="submit" disabled={updateModel.isPending}>
              {updateModel.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
