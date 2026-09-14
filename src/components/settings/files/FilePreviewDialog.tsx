"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FILE_URL_PREFIX } from "@/lib/files/media-types";
import type { ListedFile } from "@/lib/schemas/file";

type FilePreviewDialogProps = {
  file: ListedFile;
  onOpenChange: (open: boolean) => void;
};

/**
 * In-dialog image preview. Non-image types open in a new tab instead. The
 * source is our own same-origin authenticated GET (the session cookie rides
 * along); going through `next/image` would proxy the bytes through the
 * optimizer, which does not carry the user's session.
 */
export default function FilePreviewDialog({
  file,
  onOpenChange,
}: FilePreviewDialogProps) {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{file.filename}</DialogTitle>
        </DialogHeader>
        {/* eslint-disable-next-line @next/next/no-img-element -- same-origin authenticated GET; next/image's optimizer does not carry the user's session cookie */}
        <img
          src={`${FILE_URL_PREFIX}${file.id}`}
          alt={file.filename}
          className="mx-auto max-h-[70vh] w-auto max-w-full rounded-lg border border-border"
        />
      </DialogContent>
    </Dialog>
  );
}
