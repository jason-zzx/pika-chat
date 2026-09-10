"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiErrorMessage } from "@/lib/api/error-message";
import type { Assistant } from "@/lib/schemas/assistant";

import { useDeleteAssistant } from "./use-assistants";

type DeleteAssistantDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assistant: Assistant | null;
  onDeleted?: (assistant: Assistant) => void;
};

export default function DeleteAssistantDialog({
  open,
  onOpenChange,
  assistant,
  onDeleted,
}: DeleteAssistantDialogProps) {
  const remove = useDeleteAssistant();
  const t = useTranslations("Assistant");
  const tCommon = useTranslations("Common");
  const tErrors = useTranslations("Errors");
  const [error, setError] = useState<string | null>(null);
  const topicCount = assistant?.topics.length ?? 0;

  function handleOpenChange(next: boolean) {
    if (!next) {
      setError(null);
    }
    onOpenChange(next);
  }

  async function onConfirm() {
    if (!assistant) {
      return;
    }
    setError(null);
    try {
      await remove.mutateAsync(assistant.id);
      handleOpenChange(false);
      onDeleted?.(assistant);
    } catch (caught) {
      setError(apiErrorMessage(caught, tErrors, "actions.deleteAssistant"));
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("deleteTitle", { name: assistant?.name ?? "" })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("deleteDescription", { count: topicCount })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            type="button"
            variant="destructive"
            disabled={remove.isPending || !assistant}
            onClick={() => void onConfirm()}
          >
            {remove.isPending ? t("deleting") : t("delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
