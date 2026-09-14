"use client";

import { ExternalLinkIcon, EyeIcon, Trash2Icon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, useId } from "react";

import AttachmentIcon from "@/components/chat/AttachmentIcon";
import SettingsBadge from "@/components/settings/SettingsBadge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatBytes } from "@/lib/files/format";
import {
  FILE_LIST_CATEGORY_LABEL_KEYS,
  fileListCategoryOf,
  FILE_URL_PREFIX,
} from "@/lib/files/media-types";
import type { ListedFile } from "@/lib/schemas/file";

type FilesListProps = {
  files: ListedFile[];
  selectedIds: ReadonlySet<string>;
  onToggleSelect: (file: ListedFile, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onPreview: (file: ListedFile) => void;
  onDelete: (file: ListedFile) => void;
};

// Non-copy wire values for the open-in-new-tab action; hoisted so the i18next
// guard does not read them as rendered copy.
const EXTERNAL_LINK_TARGET = "_blank";
const EXTERNAL_LINK_REL = "noreferrer noopener";

// Hoisted status token (i18next/no-literal-string scans JSX attributes).
const TONE_SUCCESS = "success";

// Intl format token, kept out of JSX so the i18next guard stays quiet.
const DATE_STYLE = { dateStyle: "medium" } as const;

function FileRow({
  file,
  selectedIds,
  onToggleSelect,
  onPreview,
  onDelete,
}: {
  file: ListedFile;
  selectedIds: ReadonlySet<string>;
  onToggleSelect: (file: ListedFile, checked: boolean) => void;
  onPreview: (file: ListedFile) => void;
  onDelete: (file: ListedFile) => void;
}): ReactNode {
  const t = useTranslations("Settings.Files");
  const format = useFormatter();
  const category = fileListCategoryOf(file);
  const isImage = category === "image";
  // The disabled delete button cannot be focused, so its reason has to be
  // reachable from the always-visible in-use badge.
  const inUseBadgeId = useId();

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {/* In-use rows cannot be deleted, so they cannot be selected either —
          the same rule the row's delete button follows. */}
      <Checkbox
        checked={selectedIds.has(file.id)}
        disabled={file.referenced}
        onCheckedChange={(checked) => onToggleSelect(file, checked)}
        aria-label={t("selectFile", { filename: file.filename })}
        aria-describedby={file.referenced ? inUseBadgeId : undefined}
      />
      <AttachmentIcon
        mediaType={file.mediaType}
        filename={file.filename}
        className="size-5 text-muted-foreground"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate text-sm font-medium">{file.filename}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {/* A pending direct upload carries sizeBytes 0; a genuinely empty
              file does too, so the size is shown verbatim rather than guessed. */}
          <span>{formatBytes(file.sizeBytes)}</span>
          <span aria-hidden="true">·</span>
          <span>{format.dateTime(new Date(file.createdAt), DATE_STYLE)}</span>
          {category ? (
            <SettingsBadge dot={false}>
              {t(FILE_LIST_CATEGORY_LABEL_KEYS[category])}
            </SettingsBadge>
          ) : null}
          {file.referenced ? (
            <SettingsBadge id={inUseBadgeId} tone={TONE_SUCCESS}>
              {t("inUse")}
            </SettingsBadge>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {isImage ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("preview", { filename: file.filename })}
            onClick={() => onPreview(file)}
          >
            <EyeIcon aria-hidden="true" />
          </Button>
        ) : (
          <a
            href={`${FILE_URL_PREFIX}${file.id}`}
            target={EXTERNAL_LINK_TARGET}
            rel={EXTERNAL_LINK_REL}
            aria-label={t("open", { filename: file.filename })}
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          >
            <ExternalLinkIcon aria-hidden="true" />
          </a>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={file.referenced}
          title={file.referenced ? t("inUseHint") : undefined}
          aria-describedby={file.referenced ? inUseBadgeId : undefined}
          aria-label={t("delete", { filename: file.filename })}
          onClick={() => onDelete(file)}
        >
          <Trash2Icon aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Always-visible rows: type, name, size, date, reference state, and actions,
 * with per-row selection and a select-all that covers exactly the loaded,
 * deletable rows (referenced rows are excluded, later pages are not implied).
 */
export default function FilesList({
  files,
  selectedIds,
  onToggleSelect,
  onToggleAll,
  onPreview,
  onDelete,
}: FilesListProps) {
  const t = useTranslations("Settings.Files");
  const selectableCount = files.filter((file) => !file.referenced).length;
  const selectedSelectableCount = files.filter(
    (file) => !file.referenced && selectedIds.has(file.id),
  ).length;
  const allSelected =
    selectableCount > 0 && selectedSelectableCount === selectableCount;
  const partiallySelected =
    selectedSelectableCount > 0 && !allSelected;

  return (
    <div>
      <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-2.5">
        <Checkbox
          checked={allSelected}
          indeterminate={partiallySelected}
          disabled={selectableCount === 0}
          onCheckedChange={(checked) => onToggleAll(checked)}
          aria-label={t("selectAll")}
        />
      </div>
      <div className="divide-y divide-border">
        {files.map((file) => (
          <FileRow
            key={file.id}
            file={file}
            selectedIds={selectedIds}
            onToggleSelect={onToggleSelect}
            onPreview={onPreview}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}
