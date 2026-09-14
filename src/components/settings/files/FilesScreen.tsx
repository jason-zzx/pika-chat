"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import EmptyState from "@/components/common/EmptyState";
import SettingsCard from "@/components/settings/SettingsCard";
import SettingsSection from "@/components/settings/SettingsSection";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/api/error-message";
import type { FileListCategory } from "@/lib/files/media-types";
import type { ListedFile } from "@/lib/schemas/file";

import BatchDeleteDialog from "./BatchDeleteDialog";
import CategoryFilter from "./CategoryFilter";
import FilesList from "./FilesList";
import FilePreviewDialog from "./FilePreviewDialog";
import UsageCard from "./UsageCard";
import { useFileList } from "./use-files";

/** Attachment management: usage, filterable list, preview, and delete. */
export default function FilesScreen() {
  const t = useTranslations("Settings.Files");
  const tCommon = useTranslations("Common");
  const tErrors = useTranslations("Errors");
  const [category, setCategory] = useState<FileListCategory | null>(null);
  const [previewFile, setPreviewFile] = useState<ListedFile | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ListedFile | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const list = useFileList(category);

  const files = list.data?.pages.flatMap((page) => page.files) ?? [];
  const totalCount = list.data?.pages[0]?.totalCount ?? 0;

  // Selection is a client-side Set; rows that disappear from the list
  // (deleted, or a 409 race refetch marking them in-use) drop out of the
  // toolbar count on their own.
  const selectedFiles = files.filter((file) => selectedIds.has(file.id));

  function onCategoryChange(next: FileListCategory | null) {
    setCategory(next);
    setSelectedIds(new Set());
  }

  function onToggleSelect(file: ListedFile, checked: boolean) {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (checked) {
        next.add(file.id);
      } else {
        next.delete(file.id);
      }
      return next;
    });
  }

  /** Select-all covers the loaded, deletable rows — nothing invisible. */
  function onToggleAll(checked: boolean) {
    setSelectedIds(
      checked
        ? new Set(
            files.filter((file) => !file.referenced).map((file) => file.id),
          )
        : new Set(),
    );
  }

  function onBatchOpenChange(open: boolean) {
    setBatchDeleteOpen(open);
    if (!open) {
      // Deletion (full or partial) already invalidated the queries; dropping
      // the set here covers completion, cancellation, and the dialog's
      // close-outside tap in one place.
      setSelectedIds(new Set());
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <UsageCard />

      <SettingsSection title={t("listTitle")}>
        <CategoryFilter value={category} onChange={onCategoryChange} />

        {list.isPending ? (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        ) : list.isError ? (
          <p className="text-sm text-destructive">
            {apiErrorMessage(list.error, tErrors, "actions.loadFiles")}
          </p>
        ) : files.length === 0 ? (
          <EmptyState
            title={category ? t("emptyFilteredTitle") : t("emptyTitle")}
            description={
              category
                ? t("emptyFilteredDescription")
                : t("emptyDescription")
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              {t("listCount", { count: totalCount })}
            </p>
            {selectedFiles.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-4 py-2">
                <p className="text-sm text-muted-foreground">
                  {t("selectedCount", { count: selectedFiles.length })}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => setBatchDeleteOpen(true)}
                  >
                    {t("deleteSelected")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedIds(new Set())}
                  >
                    {tCommon("cancel")}
                  </Button>
                </div>
              </div>
            ) : null}
            <SettingsCard className="overflow-hidden">
              <FilesList
                files={files}
                selectedIds={selectedIds}
                onToggleSelect={onToggleSelect}
                onToggleAll={onToggleAll}
                onPreview={setPreviewFile}
                onDelete={setDeleteTarget}
              />
            </SettingsCard>
            {list.hasNextPage ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit self-center"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage
                  ? t("loadMorePending")
                  : t("loadMore")}
              </Button>
            ) : null}
          </div>
        )}
      </SettingsSection>

      {previewFile ? (
        <FilePreviewDialog
          file={previewFile}
          onOpenChange={(open) => {
            if (!open) {
              setPreviewFile(null);
            }
          }}
        />
      ) : null}
      {deleteTarget ? (
        <BatchDeleteDialog
          files={[deleteTarget]}
          onOpenChange={(open) => {
            if (!open) {
              setDeleteTarget(null);
            }
          }}
        />
      ) : null}
      {batchDeleteOpen ? (
        <BatchDeleteDialog
          files={selectedFiles}
          onOpenChange={onBatchOpenChange}
        />
      ) : null}
    </div>
  );
}
