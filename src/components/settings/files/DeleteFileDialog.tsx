"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

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
import type { ListedFile } from "@/lib/schemas/file";

import { useDeleteFile } from "./use-files";

type DeleteFileDialogProps = {
  file: ListedFile;
  onOpenChange: (open: boolean) => void;
};

/**
 * Confirms and performs the delete. A 409 (`file.inUse`) is the truth when the
 * reference state changed after the list loaded: it is surfaced here and the
 * list refetches, so the row turns into its in-use state.
 */
export default function DeleteFileDialog({
  file,
  onOpenChange,
}: DeleteFileDialogProps) {
  const t = useTranslations("Settings.Files");
  const tCommon = useTranslations("Common");
  const tErrors = useTranslations("Errors");
  const [error, setError] = useState<string | null>(null);
  const deleteFile = useDeleteFile();

  async function onConfirm() {
    setError(null);
    try {
      await deleteFile.mutateAsync(file.id);
      onOpenChange(false);
    } catch (caught) {
      setError(apiErrorMessage(caught, tErrors, "actions.deleteFile"));
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("deleteTitle")}</DialogTitle>
          <DialogDescription>
            {t("deleteDescription", { filename: file.filename })}
          </DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={deleteFile.isPending}
            onClick={() => void onConfirm()}
          >
            {deleteFile.isPending ? t("deleting") : t("deleteConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
