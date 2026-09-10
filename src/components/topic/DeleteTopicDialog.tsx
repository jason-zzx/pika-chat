"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { useDeleteTopic } from "@/components/assistant/use-assistants";
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
import type { Topic } from "@/lib/schemas/topic";

type DeleteTopicDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topic: Topic | null;
  onDeleted?: (id: string) => void;
};

export default function DeleteTopicDialog({
  open,
  onOpenChange,
  topic,
  onDeleted,
}: DeleteTopicDialogProps) {
  const remove = useDeleteTopic();
  const t = useTranslations("Errors");
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setError(null);
    }
    onOpenChange(next);
  }

  async function onConfirm() {
    if (!topic) {
      return;
    }
    setError(null);
    try {
      const id = topic.id;
      await remove.mutateAsync(id);
      handleOpenChange(false);
      onDeleted?.(id);
    } catch (caught) {
      setError(apiErrorMessage(caught, t, "actions.deleteTopic"));
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {topic?.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            This topic will be permanently deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            type="button"
            variant="destructive"
            disabled={remove.isPending || !topic}
            onClick={() => void onConfirm()}
          >
            {remove.isPending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
