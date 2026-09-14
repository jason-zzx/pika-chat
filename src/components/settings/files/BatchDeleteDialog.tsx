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
import { fileKeys } from "@/hooks/use-file-limits";
import { apiErrorCode, apiErrorMessage } from "@/lib/api/error-message";
import { deleteChatFile } from "@/lib/api/files";
import type { ListedFile } from "@/lib/schemas/file";

type BatchDeleteDialogProps = {
  files: ListedFile[];
  onOpenChange: (open: boolean) => void;
};

type BatchResult = { deleted: number; skipped: number };

/**
 * Confirms and performs the delete of one or more files. There is deliberately
 * no server-side batch endpoint: each file goes through the same
 * `DELETE /api/files/[id]` (ownership, in-use 409, and provider-side cleanup
 * included), and the results are settled client-side. A rejection means "not
 * deleted" — the expected case is the 409 race where a message started
 * referencing the file after the list loaded.
 *
 * A single file keeps the row action's flow: success closes the dialog, any
 * failure stays open with the error inline. A batch stays open with a summary
 * — a 409 is reported as skipped (the refetch marks the row in use) and only
 * other failures surface as an error alongside the summary.
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
  const single = files.length === 1 ? files[0] : undefined;

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
      // Settled, not success: a 409 means a message started referencing the
      // file after this page loaded, so the list refetches to show it as
      // in-use either way. One invalidate refreshes the list and the usage
      // card together.
      await queryClient.invalidateQueries({ queryKey: fileKeys.all });
      const failure = results.find((entry) => entry.status === "rejected");
      if (single) {
        if (failure?.status === "rejected") {
          setError(
            apiErrorMessage(failure.reason, tErrors, "actions.deleteFile"),
          );
        } else {
          onOpenChange(false);
        }
        return;
      }
      setResult({ deleted, skipped: results.length - deleted });
      if (
        failure?.status === "rejected" &&
        apiErrorCode(failure.reason) !== "CONFLICT"
      ) {
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
          <DialogTitle>
            {single ? t("deleteTitle") : t("batchTitle")}
          </DialogTitle>
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
              {single
                ? t("deleteDescription", { filename: single.filename })
                : t("batchDescription", { count: files.length })}
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
                {isDeleting
                  ? single
                    ? t("deleting")
                    : t("batchDeleting")
                  : single
                    ? t("deleteConfirm")
                    : t("deleteSelected")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
