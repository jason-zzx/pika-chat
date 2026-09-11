"use client";

import { BrainIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";

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
  DEFAULT_MODEL_CONTEXT_TOKENS,
  isReasoningEffortChoice,
  REASONING_EFFORT_CHOICES,
  SEEDED_REASONING_OPTIONS,
  type AddProviderModelInput,
  type ProviderModel,
  type ReasoningEffortChoice,
} from "@/lib/schemas/provider";
import { cn } from "@/lib/utils";

import { ModalityIcon } from "./model-capabilities";
import {
  useAddProviderModel,
  useUpdateProviderModel,
} from "./use-provider-configs";

const INPUT_MODALITIES = ["text", "image", "audio", "video", "pdf"] as const;

// Hoisted wire tokens (i18next/no-literal-string): dirty-field keys.
const FIELD_CONTEXT_TOKENS = "contextTokens";
const FIELD_REASONING = "reasoning";
const FIELD_VENDOR_KEY = "vendorKey";

type ModelEditorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  configId: string;
  /** Omit to switch into create mode with an editable model id. */
  model?: ProviderModel;
};

/** Chip-style toggle used for modalities, reasoning, and effort options. */
function ToggleChip({
  pressed,
  onToggle,
  children,
  disabled,
}: {
  pressed: boolean;
  onToggle: (next: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={() => onToggle(!pressed)}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm leading-none transition-colors",
        pressed
          ? "border-primary/60 bg-primary/15 text-foreground"
          : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export default function ModelEditorDialog({
  open,
  onOpenChange,
  configId,
  model,
}: ModelEditorDialogProps) {
  const isCreate = model === undefined;
  const t = useTranslations("Provider");
  const tErrors = useTranslations("Errors");
  const updateModel = useUpdateProviderModel();
  const addModel = useAddProviderModel();
  const [modelId, setModelId] = useState("");
  const [contextTokens, setContextTokens] = useState(
    String(model?.contextTokens ?? DEFAULT_MODEL_CONTEXT_TOKENS),
  );
  const [inputModalities, setInputModalities] = useState(
    () => new Set(model?.inputModalities ?? ["text"]),
  );
  const [reasoning, setReasoning] = useState(model?.reasoning ?? false);
  const [reasoningOptions, setReasoningOptions] = useState(
    () =>
      new Set(
        model?.reasoningOptions.filter(isReasoningEffortChoice) ??
          SEEDED_REASONING_OPTIONS,
      ),
  );
  const [vendorKey, setVendorKey] = useState(model?.vendorKey ?? "");
  // Create mode only sends fields the user touched, so catalog metadata for
  // the model id still wins for everything else.
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const pending = updateModel.isPending || addModel.isPending;

  function markDirty(field: string) {
    setDirty((current) => {
      if (current.has(field)) {
        return current;
      }
      const next = new Set(current);
      next.add(field);
      return next;
    });
  }

  function toggleModality(modality: string, checked: boolean) {
    markDirty("inputModalities");
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
    markDirty("reasoning");
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

  function parseContext(): number | null {
    const parsed = Number.parseInt(contextTokens, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function orderedModalities(): string[] {
    return INPUT_MODALITIES.filter((modality) => inputModalities.has(modality));
  }

  function orderedEfforts(): ReasoningEffortChoice[] {
    return REASONING_EFFORT_CHOICES.filter((option) =>
      reasoningOptions.has(option),
    );
  }

  async function handleCreate(parsedContext: number, modalities: string[]) {
    const trimmedId = modelId.trim();
    if (trimmedId.length === 0) {
      return;
    }
    const input: AddProviderModelInput = { modelId: trimmedId };
    if (dirty.has("contextTokens")) {
      input.contextTokens = parsedContext;
    }
    if (dirty.has("inputModalities")) {
      input.inputModalities = modalities;
    }
    if (dirty.has("reasoning")) {
      input.reasoning = reasoning;
      input.reasoningOptions = reasoning
        ? orderedEfforts()
        : [];
    }
    if (dirty.has("vendorKey")) {
      input.vendorKey = isModelVendorKey(vendorKey) ? vendorKey : null;
    }
    await addModel.mutateAsync({ configId, input });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedContext = parseContext();
    if (parsedContext === null) {
      setError(t("invalidContext"));
      return;
    }
    const modalities = orderedModalities();
    if (modalities.length === 0) {
      setError(t("invalidModalities"));
      return;
    }
    setError(null);
    try {
      if (isCreate) {
        await handleCreate(parsedContext, modalities);
      } else {
        const options = reasoning
          ? orderedEfforts()
          : (model?.reasoningOptions ?? []);
        await updateModel.mutateAsync({
          configId,
          modelId: model?.modelId ?? "",
          input: {
            contextTokens: parsedContext,
            inputModalities: modalities,
            reasoning,
            reasoningOptions: reasoning
              ? options.length > 0
                ? options
                : [...SEEDED_REASONING_OPTIONS]
              : undefined,
            vendorKey: isModelVendorKey(vendorKey) ? vendorKey : null,
          },
        });
      }
      onOpenChange(false);
    } catch (caught) {
      setError(
        apiErrorMessage(
          caught,
          tErrors,
          isCreate ? "actions.addModel" : "actions.saveModel",
        ),
      );
    }
  }

  async function handleReset() {
    if (!model) {
      return;
    }
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
      setError(apiErrorMessage(caught, tErrors, "actions.resetFromCatalog"));
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
              {isCreate ? (
                t("addModel")
              ) : (
                <>
                  <ModelVendorIcon
                    modelId={model.modelId}
                    vendorKey={vendorKey.length > 0 ? vendorKey : model.vendorKey}
                  />
                  {model.modelId}
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {isCreate ? t("addModelDescription") : t("contextDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {isCreate ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="model-id">{t("modelIdLabel")}</Label>
                <Input
                  id="model-id"
                  required
                  value={modelId}
                  placeholder={t("modelIdPlaceholder")}
                  onChange={(event) => setModelId(event.currentTarget.value)}
                />
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="model-context">{t("contextTokensLabel")}</Label>
              <Input
                id="model-context"
                inputMode="numeric"
                value={contextTokens}
                onChange={(event) => {
                  markDirty(FIELD_CONTEXT_TOKENS);
                  setContextTokens(event.currentTarget.value);
                }}
              />
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">
                {t("inputModalitiesLabel")}
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {INPUT_MODALITIES.map((modality) => (
                  <ToggleChip
                    key={modality}
                    pressed={inputModalities.has(modality)}
                    onToggle={(next) => toggleModality(modality, next)}
                  >
                    <ModalityIcon modality={modality} className="size-3.5" />
                    {modality}
                  </ToggleChip>
                ))}
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">
                {t("supportsReasoning")}
              </legend>
              <div className="flex flex-wrap gap-1.5">
                <ToggleChip
                  pressed={reasoning}
                  onToggle={(next) => {
                    markDirty(FIELD_REASONING);
                    setReasoning(next);
                  }}
                >
                  <BrainIcon className="size-3.5" />
                  {reasoning ? t("reasoningOn") : t("reasoningOff")}
                </ToggleChip>
              </div>
              {reasoning ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {REASONING_EFFORT_CHOICES.map((option) => (
                    <ToggleChip
                      key={option}
                      pressed={reasoningOptions.has(option)}
                      onToggle={(next) => toggleEffort(option, next)}
                    >
                      {option}
                    </ToggleChip>
                  ))}
                </div>
              ) : null}
            </fieldset>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="model-vendor">{t("vendorIconLabel")}</Label>
              <Select
                // eslint-disable-next-line i18next/no-literal-string -- "auto" vendor wire sentinel, not copy
                value={vendorKey.length > 0 ? vendorKey : "auto"}
                onValueChange={(next) => {
                  if (typeof next !== "string") {
                    return;
                  }
                  markDirty(FIELD_VENDOR_KEY);
                  setVendorKey(next === "auto" ? "" : next);
                }}
              >
                <SelectTrigger id="model-vendor" className="w-full">
                  <SelectValue placeholder={t("auto")}>
                    {isModelVendorKey(vendorKey)
                      ? MODEL_VENDOR_LABELS[vendorKey]
                      : t("auto")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {/* eslint-disable-next-line i18next/no-literal-string -- select wire value, not copy */}
                  <SelectItem value="auto">{t("auto")}</SelectItem>
                  {MODEL_VENDOR_KEYS.map((key) => (
                    <SelectItem key={key} value={key}>
                      <span className="flex items-center gap-2">
                        <ModelVendorIcon
                          modelId={isCreate ? modelId : model.modelId}
                          vendorKey={key}
                        />
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
            {isCreate ? null : (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  void handleReset();
                }}
              >
                {t("resetFromCatalog")}
              </Button>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? t("saving") : isCreate ? t("add") : t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
