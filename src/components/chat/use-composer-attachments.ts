"use client";

import { useCallback, useEffect, useState } from "react";

import {
  DEFAULT_FILE_LIMITS,
  deleteChatFile,
  fetchFileLimits,
  uploadChatFile,
  uploadChatFileDirect,
} from "@/lib/api/files";
import type { ErrorMessageParams } from "@/lib/api/error-contract";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "@/lib/files/constants";
import { formatBytes } from "@/lib/files/format";
import { classifyFile, fileIdFromUrl } from "@/lib/files/media-types";
import { newId } from "@/lib/id";
import type { FileLimits } from "@/lib/schemas/file";
import {
  useComposerStore,
  type StagedAttachment,
} from "@/stores/composer-store";

const EMPTY_ATTACHMENTS: StagedAttachment[] = [];

/**
 * Staged entries that occupy one of the per-message attachment slots.
 *
 * Rejected entries (`status: "error"`) never uploaded and must not consume a
 * slot, so the cap check and the paperclip's disabled state share this one
 * definition instead of drifting apart.
 */
export function stagedAttachmentSlotCount(
  attachments: readonly StagedAttachment[],
): number {
  return attachments.filter((entry) => entry.status !== "error").length;
}

/**
 * Client-side validation failures are shaped like the API error envelope so the
 * chip can resolve them through `apiErrorMessage` exactly like a server error.
 */
function validationError(
  messageKey: "file.tooLarge" | "file.unsupportedType" | "file.tooMany",
  params?: ErrorMessageParams,
): unknown {
  return { error: { code: "VALIDATION_FAILED", messageKey, params } };
}

function stagedFile(
  id: string,
  file: File,
  error: unknown,
): StagedAttachment {
  return {
    id,
    file,
    filename: file.name,
    mediaType: file.type,
    sizeBytes: file.size,
    status: "error",
    error,
  };
}

/**
 * Attachment staging for one composer draft key. Files upload on selection
 * (not on send) so type/size/extraction problems surface on the chip before the
 * turn is sent; the draft bucket mirrors the draft text — same key, same
 * lifetime.
 */
export function useComposerAttachments(draftKey: string) {
  const attachments = useComposerStore(
    (state) => state.attachments[draftKey] ?? EMPTY_ATTACHMENTS,
  );
  const updateAttachments = useComposerStore(
    (state) => state.updateAttachments,
  );
  // Starts at the fallback limits so a file selected before the fetch settles
  // is still pre-checked, then tightens to the operator's configured size.
  const [limits, setLimits] = useState<FileLimits>(DEFAULT_FILE_LIMITS);

  useEffect(() => {
    let active = true;
    void fetchFileLimits().then((fetched) => {
      if (active) {
        setLimits(fetched);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const upload = useCallback(
    (localId: string, file: File) => {
      // Direct upload when the server advertises it: presign → browser→S3 →
      // complete. The relay path is unchanged and stays the default. Either
      // way a failure lands on the chip as a retryable error.
      const request = limits.directUpload
        ? uploadChatFileDirect(file)
        : uploadChatFile(file);
      void request.then(
        (uploaded) => {
          updateAttachments(draftKey, (current) =>
            current.map((entry) =>
              entry.id === localId
                ? {
                    ...entry,
                    status: "ready",
                    url: uploaded.url,
                    filename: uploaded.filename,
                    mediaType: uploaded.mediaType,
                    sizeBytes: uploaded.sizeBytes,
                    extraction: uploaded.extraction,
                    error: undefined,
                  }
                : entry,
            ),
          );
        },
        (error: unknown) => {
          updateAttachments(draftKey, (current) =>
            current.map((entry) =>
              entry.id === localId
                ? { ...entry, status: "error", error }
                : entry,
            ),
          );
        },
      );
    },
    [draftKey, limits.directUpload, updateAttachments],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) {
        return;
      }
      // Read the latest bucket so a rapid second drop cannot clobber the first.
      const current =
        useComposerStore.getState().attachments[draftKey] ?? EMPTY_ATTACHMENTS;
      const staged: StagedAttachment[] = [];
      const uploads: { id: string; file: File }[] = [];
      // Only staged entries that will occupy a slot count toward the cap — a
      // file rejected for size/type must not consume a slot it never gets.
      let count = stagedAttachmentSlotCount(current);
      for (const file of files) {
        const id = newId();
        if (file.size > limits.maxFileBytes) {
          staged.push(
            stagedFile(
              id,
              file,
              validationError("file.tooLarge", {
                limit: formatBytes(limits.maxFileBytes),
              }),
            ),
          );
          continue;
        }
        if (!classifyFile({ mediaType: file.type, filename: file.name })) {
          staged.push(
            stagedFile(id, file, validationError("file.unsupportedType")),
          );
          continue;
        }
        if (count >= MAX_ATTACHMENTS_PER_MESSAGE) {
          staged.push(
            stagedFile(
              id,
              file,
              validationError("file.tooMany", {
                max: MAX_ATTACHMENTS_PER_MESSAGE,
              }),
            ),
          );
          continue;
        }
        count += 1;
        staged.push({
          id,
          file,
          filename: file.name,
          mediaType: file.type,
          sizeBytes: file.size,
          status: "uploading",
        });
        uploads.push({ id, file });
      }
      updateAttachments(draftKey, (list) => [...list, ...staged]);
      for (const pending of uploads) {
        upload(pending.id, pending.file);
      }
    },
    [draftKey, limits.maxFileBytes, updateAttachments, upload],
  );

  const removeAttachment = useCallback(
    (id: string) => {
      const current =
        useComposerStore.getState().attachments[draftKey] ?? EMPTY_ATTACHMENTS;
      const attachment = current.find((entry) => entry.id === id);
      updateAttachments(draftKey, (list) =>
        list.filter((entry) => entry.id !== id),
      );
      const fileId = attachment?.url ? fileIdFromUrl(attachment.url) : null;
      if (attachment?.status === "ready" && fileId) {
        // Best-effort: a referenced file answers 409 (silently ignored — the
        // message-deletion cascade reclaims it), a network failure leaves the
        // orphan to the server-side sweeper.
        void deleteChatFile(fileId).catch(() => undefined);
      }
    },
    [draftKey, updateAttachments],
  );

  const retryAttachment = useCallback(
    (id: string) => {
      const current =
        useComposerStore.getState().attachments[draftKey] ?? EMPTY_ATTACHMENTS;
      const attachment = current.find((entry) => entry.id === id);
      if (!attachment) {
        return;
      }
      updateAttachments(draftKey, (list) =>
        list.map((entry) =>
          entry.id === id
            ? { ...entry, status: "uploading", error: undefined }
            : entry,
        ),
      );
      upload(id, attachment.file);
    },
    [draftKey, updateAttachments, upload],
  );

  /** Drops staged attachments without deleting the uploaded objects — called
   * after a send, when they are about to be referenced by the message. */
  const clearAttachments = useCallback(
    (key: string) => {
      updateAttachments(key, () => []);
    },
    [updateAttachments],
  );

  /** Puts attachments back after a failed send so the user can retry. */
  const restoreAttachments = useCallback(
    (key: string, restored: StagedAttachment[]) => {
      if (restored.length === 0) {
        return;
      }
      updateAttachments(key, (list) => {
        const present = new Set(list.map((entry) => entry.id));
        return [
          ...list,
          ...restored.filter((entry) => !present.has(entry.id)),
        ];
      });
    },
    [updateAttachments],
  );

  return {
    attachments,
    addFiles,
    removeAttachment,
    retryAttachment,
    clearAttachments,
    restoreAttachments,
  };
}
