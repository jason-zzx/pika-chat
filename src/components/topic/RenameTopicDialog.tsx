"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { useRenameTopic } from "@/components/assistant/use-assistants";
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
import { apiErrorMessage } from "@/lib/api/error-message";
import type { Topic } from "@/lib/schemas/topic";

type RenameTopicDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topic: Topic | null;
};

export default function RenameTopicDialog({
  open,
  onOpenChange,
  topic,
}: RenameTopicDialogProps) {
  const rename = useRenameTopic();
  const router = useRouter();
  const t = useTranslations("Topic");
  const tErrors = useTranslations("Errors");
  const [title, setTitle] = useState(topic?.title ?? "");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!topic) {
      return;
    }
    setError(null);
    try {
      await rename.mutateAsync({ id: topic.id, input: { title: title.trim() } });
      router.refresh();
      onOpenChange(false);
    } catch (caught) {
      setError(apiErrorMessage(caught, tErrors, "actions.renameTopic"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <DialogHeader>
            <DialogTitle>{t("renameTitle")}</DialogTitle>
            <DialogDescription>{t("renameDescription")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <Label htmlFor="topic-title">{t("titleLabel")}</Label>
            <Input
              id="topic-title"
              name="title"
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={rename.isPending || !topic}>
              {rename.isPending ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
