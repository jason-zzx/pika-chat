"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import ModelPicker from "@/components/chat/ModelPicker";
import { pairFromIds, sameModelPick } from "@/components/chat/model-pick";
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
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage } from "@/lib/api/error-message";
import {
  DEFAULT_ASSISTANT_ICON,
  type Assistant,
  type CreateAssistantInput,
} from "@/lib/schemas/assistant";
import type { ComposerModelPick } from "@/stores/composer-store";

import AssistantEmojiPicker from "./AssistantEmojiPicker";
import {
  useCreateAssistant,
  useUpdateAssistant,
} from "./use-assistants";

type AssistantEditorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assistant: Assistant | null;
};

export default function AssistantEditorDialog({
  open,
  onOpenChange,
  assistant,
}: AssistantEditorDialogProps) {
  const t = useTranslations("Assistant");
  const tErrors = useTranslations("Errors");
  const isEdit = assistant !== null;
  const models = useAvailableModels();
  const create = useCreateAssistant();
  const update = useUpdateAssistant();
  const pair = pairFromIds(
    assistant?.defaultProviderConfigId,
    assistant?.defaultModelId,
  );
  const storedIsAvailable =
    !pair ||
    !models.data ||
    models.data.some((model) => sameModelPick(model, pair));
  const derivedPick =
    pair && storedIsAvailable ? pair : null;

  const [name, setName] = useState(assistant?.name ?? "");
  const [icon, setIcon] = useState(assistant?.icon ?? DEFAULT_ASSISTANT_ICON);
  const [systemPrompt, setSystemPrompt] = useState(
    assistant?.systemPrompt ?? "",
  );
  const [modelOverride, setModelOverride] = useState<
    ComposerModelPick | null | undefined
  >(undefined);
  const [error, setError] = useState<string | null>(null);
  const modelValue = modelOverride === undefined ? derivedPick : modelOverride;

  const pending = create.isPending || update.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedPrompt = systemPrompt.trim();
    const input: CreateAssistantInput = {
      name: name.trim(),
      icon: icon.trim(),
      systemPrompt: trimmedPrompt.length > 0 ? trimmedPrompt : null,
      defaultProviderConfigId: modelValue?.configId ?? null,
      defaultModelId: modelValue?.modelId ?? null,
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
      setError(apiErrorMessage(caught, tErrors, "actions.saveAssistant"));
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
              {isEdit ? t("editTitle") : t("newTitle")}
            </DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <Label htmlFor="assistant-name">{t("nameLabel")}</Label>
            <Input
              id="assistant-name"
              name="name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="assistant-icon">{t("emojiLabel")}</Label>
            <AssistantEmojiPicker
              id="assistant-icon"
              value={icon}
              onChange={setIcon}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="assistant-prompt">{t("systemPromptLabel")}</Label>
            <Textarea
              id="assistant-prompt"
              name="systemPrompt"
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="assistant-model">{t("defaultModelLabel")}</Label>
            <ModelPicker
              id="assistant-model"
              value={modelValue}
              onChange={setModelOverride}
              allowClear
            />
            {models.data && pair && !storedIsAvailable ? (
              <p className="text-sm text-muted-foreground">
                {t("staleModel")}
              </p>
            ) : null}
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
