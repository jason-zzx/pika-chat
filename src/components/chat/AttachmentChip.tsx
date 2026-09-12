"use client";

import {
  AlertTriangleIcon,
  Loader2Icon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/api/error-message";
import { formatBytes } from "@/lib/files/format";
import { cn } from "@/lib/utils";
import type { StagedAttachment } from "@/stores/composer-store";

import AttachmentIcon from "./AttachmentIcon";

type AttachmentChipProps = {
  attachment: StagedAttachment;
  onRemove: () => void;
  onRetry: () => void;
  disabled?: boolean;
};

/**
 * One staged attachment: name + size + upload state, with visible (never
 * hover-only) warnings for an unreadable/empty/truncated file. A failed upload
 * offers retry next to remove.
 */
export default function AttachmentChip({
  attachment,
  onRemove,
  onRetry,
  disabled = false,
}: AttachmentChipProps) {
  const t = useTranslations("Files");
  const tErrors = useTranslations("Errors");
  const failed = attachment.status === "error";
  // Image chips show a thumbnail served by our own authenticated route once
  // the upload is ready. A local object URL (useMemo + revoke-on-unmount)
  // tears under StrictMode's double-effect — the URL is revoked right after
  // mount — so the chip never creates one. While uploading, the spinner
  // keeps its place next to the category icon.
  const previewUrl =
    attachment.mediaType.startsWith("image/") && attachment.status === "ready"
      ? attachment.url
      : undefined;
  const warnings: string[] = [];
  if (failed) {
    warnings.push(apiErrorMessage(attachment.error, tErrors, "file.uploadFailed"));
  }
  const extraction = attachment.extraction;
  if (!failed && extraction) {
    if (extraction.status === "empty") {
      warnings.push(t("warning.empty"));
    }
    if (extraction.status === "failed") {
      warnings.push(t("warning.failed"));
    }
    if (extraction.truncated) {
      warnings.push(t("warning.truncated"));
    }
  }

  return (
    <div
      className={cn(
        "flex max-w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-xs",
        failed ? "border-destructive/50" : "border-border bg-background/60",
      )}
    >
      {previewUrl ? (
        <span className="relative size-8 shrink-0 overflow-hidden rounded">
          {/* eslint-disable-next-line @next/next/no-img-element -- attachment bytes are served by our own authenticated route; next/image would proxy and resize */}
          <img
            src={previewUrl}
            alt=""
            className="size-full object-cover"
          />
        </span>
      ) : attachment.status === "uploading" ? (
        <Loader2Icon
          aria-hidden="true"
          className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
        />
      ) : (
        <AttachmentIcon
          mediaType={attachment.mediaType}
          filename={attachment.filename}
        />
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span
          className="max-w-[12rem] truncate font-medium"
          title={attachment.filename}
        >
          {attachment.filename}
        </span>
        <span className="text-muted-foreground">
          {attachment.status === "uploading"
            ? t("uploading")
            : formatBytes(attachment.sizeBytes)}
        </span>
        {warnings.map((warning, index) => (
          <span
            key={index}
            className="flex items-center gap-1 text-destructive"
          >
            <AlertTriangleIcon aria-hidden="true" className="size-3 shrink-0" />
            {warning}
          </span>
        ))}
      </div>
      {failed ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t("retry")}
          disabled={disabled}
          onClick={onRetry}
        >
          <RotateCcwIcon aria-hidden="true" />
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t("remove", { filename: attachment.filename })}
        disabled={disabled}
        onClick={onRemove}
      >
        <XIcon aria-hidden="true" />
      </Button>
    </div>
  );
}
