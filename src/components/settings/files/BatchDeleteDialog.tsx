"use client";

import { useQueryClient } from "@tanstack/react-query";
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
import { deleteChatFile } from "@/lib/api/files";
import type { ListedFile } from "@/lib/schemas/file";

import { fileKeys } from "./use-files";

type BatchDeleteDialogProps = {
  files: ListedFile[];
  onOpenChange: (open: boolean) => void;
};

type BatchResult = { deleted: number; skipped: number };

/** The 409 race: the envelope the file route answers for a referenced file. */
function isInUseConflict(reason: unknown): boolean {
  return (
    typeof reason === "object" &&
    reason !== null &&
    "error" in reason &&
    (reason as { error?: { code?: string } }).error?.code === "CONFLICT"
  );
}

/**
 * Confirms and performs a batch delete. There is deliberately no server-side
 * batch endpoint: each file goes through the same `DELETE /api/files/[id]`
 * (ownership, in-use 409, and provider-side cleanup included), and the results
 * are settled client-side. A rejection means "not deleted" — the expected case
 * is the 409 race where a message started referencing the file after the list
 * loaded — so it is reported as skipped and the refetch marks it in use.
 */
export default function BatchDeleteDialog({
  files,
  onOpenChange,
}: BatchDeleteDialogProps) {
  const t = useTranslations("Settings.Files");
  const tCommon = useTranslations("Common");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const [result, setResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  async function onConfirm() {
    setError(null);
    setIsDeleting(true);
    try {
      const results = await Promise.allSettled(
        files.map((file) => deleteChatFile(file.id)),
      );
      const deleted = results.filter(
        (entry) => entry.status === "fulfilled",
      ).length;
      // One invalidate refreshes the list and the usage card together; the
      // skipped rows come back marked in-use.
      await queryClient.invalidateQueries({ queryKey: fileKeys.all });
      setResult({ deleted, skipped: results.length - deleted });
      const failure = results.find((entry) => entry.status === "rejected");
      if (failure?.status === "rejected" && !isInUseConflict(failure.reason)) {
        // A 409 `file.inUse` is the expected race and already counted as
        // skipped; anything else is surfaced alongside the summary.
        setError(
          apiErrorMessage(failure.reason, tErrors, "actions.deleteFile"),
        );
      }
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("batchTitle")}</DialogTitle>
          {result ? (
            <DialogDescription>
              {result.skipped > 0
                ? t("batchResult", {
                    deleted: result.deleted,
                    skipped: result.skipped,
                  })
                : t("batchResultClean", { deleted: result.deleted })}
            </DialogDescription>
          ) : (
            <DialogDescription>
              {t("batchDescription", { count: files.length })}
            </DialogDescription>
          )}
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          {result ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              {tCommon("close")}
            </Button>
          ) : (
            <>
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
                disabled={isDeleting}
                onClick={() => void onConfirm()}
              >
                {isDeleting ? t("batchDeleting") : t("deleteSelected")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
