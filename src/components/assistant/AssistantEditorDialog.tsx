"use client";

import { useState, type FormEvent } from "react";

import { useAvailableModels } from "@/components/provider/use-available-models";
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
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage } from "@/lib/api/error-message";
import {
  DEFAULT_ASSISTANT_ICON,
  type Assistant,
  type CreateAssistantInput,
} from "@/lib/schemas/assistant";
import type { AvailableModel } from "@/lib/schemas/provider";

import {
  useCreateAssistant,
  useUpdateAssistant,
} from "./use-assistants";

const NONE_VALUE = "none";

type AssistantEditorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assistant: Assistant | null;
};

function encodeModel(configId: string, modelId: string): string {
  return `${configId}::${modelId}`;
}

function decodeModel(
  value: string,
): { configId: string; modelId: string } | null {
  if (value === NONE_VALUE || value.length === 0) {
    return null;
  }
  const separator = value.indexOf("::");
  if (separator <= 0) {
    return null;
  }
  return {
    configId: value.slice(0, separator),
    modelId: value.slice(separator + 2),
  };
}

function modelLabel(model: AvailableModel): string {
  if (model.provenance === "shared") {
    const who = model.ownerName ?? "another user";
    return `${model.modelId} · ${model.configName} (shared by ${who})`;
  }
  return `${model.modelId} · ${model.configName}`;
}

function storedPair(assistant: Assistant | null): {
  configId: string;
  modelId: string;
} | null {
  if (!assistant?.defaultProviderConfigId || !assistant.defaultModelId) {
    return null;
  }
  return {
    configId: assistant.defaultProviderConfigId,
    modelId: assistant.defaultModelId,
  };
}

function initialModelValue(
  assistant: Assistant | null,
  models: AvailableModel[],
): string {
  const pair = storedPair(assistant);
  if (!pair) {
    return NONE_VALUE;
  }
  const available = models.some(
    (model) =>
      model.configId === pair.configId && model.modelId === pair.modelId,
  );
  return available ? encodeModel(pair.configId, pair.modelId) : NONE_VALUE;
}

export default function AssistantEditorDialog({
  open,
  onOpenChange,
  assistant,
}: AssistantEditorDialogProps) {
  const isEdit = assistant !== null;
  const models = useAvailableModels();
  const create = useCreateAssistant();
  const update = useUpdateAssistant();
  const available = models.data ?? [];
  const pair = storedPair(assistant);
  const storedIsAvailable =
    !pair ||
    available.some(
      (model) =>
        model.configId === pair.configId && model.modelId === pair.modelId,
    );

  const [name, setName] = useState(assistant?.name ?? "");
  const [icon, setIcon] = useState(assistant?.icon ?? DEFAULT_ASSISTANT_ICON);
  const [systemPrompt, setSystemPrompt] = useState(
    assistant?.systemPrompt ?? "",
  );
  const [modelOverride, setModelOverride] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const derivedModelValue = models.data
    ? initialModelValue(assistant, models.data)
    : NONE_VALUE;
  const modelValue = modelOverride ?? derivedModelValue;

  const pending = create.isPending || update.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const decoded = decodeModel(modelValue);
    const trimmedPrompt = systemPrompt.trim();
    const input: CreateAssistantInput = {
      name: name.trim(),
      icon: icon.trim(),
      systemPrompt: trimmedPrompt.length > 0 ? trimmedPrompt : null,
      defaultProviderConfigId: decoded?.configId ?? null,
      defaultModelId: decoded?.modelId ?? null,
    };
    setError(null);
    try {
      if (isEdit) {
        await update.mutateAsync({ id: assistant.id, input });
      } else {
        await create.mutateAsync(input);
      }
      onOpenChange(false);
    } catch (caught) {
      setError(apiErrorMessage(caught, "Unable to save assistant"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <DialogHeader>
            <DialogTitle>
              {isEdit ? "Edit assistant" : "New assistant"}
            </DialogTitle>
            <DialogDescription>
              Name, emoji, prompt, and an optional default model.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <Label htmlFor="assistant-name">Name</Label>
            <Input
              id="assistant-name"
              name="name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="assistant-icon">Emoji</Label>
            <Input
              id="assistant-icon"
              name="icon"
              required
              maxLength={8}
              value={icon}
              onChange={(event) => setIcon(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="assistant-prompt">System prompt</Label>
            <Textarea
              id="assistant-prompt"
              name="systemPrompt"
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="assistant-model">Default model</Label>
            <Select
              value={modelValue}
              onValueChange={(value) =>
                setModelOverride(value ?? NONE_VALUE)
              }
            >
              <SelectTrigger id="assistant-model" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>No default model</SelectItem>
                {available.map((model) => (
                  <SelectItem
                    key={encodeModel(model.configId, model.modelId)}
                    value={encodeModel(model.configId, model.modelId)}
                  >
                    {modelLabel(model)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {models.data && pair && !storedIsAvailable ? (
              <p className="text-sm text-muted-foreground">
                The previously selected model is no longer available.
              </p>
            ) : null}
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
