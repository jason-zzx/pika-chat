"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { CheckIcon, RefreshCwIcon, SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SharedTooltip } from "@/components/ui/tooltip";
import { apiErrorMessage } from "@/lib/api/error-message";
import { cn } from "@/lib/utils";

import {
  useDiscoverProviderModels,
  useSyncProviderModels,
} from "./use-provider-configs";

// Hoisted wire tokens (i18next/no-literal-string): tab identifiers and row badges.
const TAB_CURRENT = "current";
const TAB_MISSING = "missing";
type DiscoveryTab = typeof TAB_CURRENT | typeof TAB_MISSING;

const ROW_BADGE = {
  add: { key: "pendingAdd", className: "font-medium text-primary" },
  remove: { key: "pendingRemove", className: "font-medium text-destructive" },
  existing: { key: "alreadyAdded", className: "text-muted-foreground" },
} as const;

type DiscoverModelsDialogProps = {
  configId: string;
  configName: string;
  /** Models already added to this config — checked by default (checked = keep). */
  existingModelIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function DiscoverModelsDialog({
  configId,
  configName,
  existingModelIds,
  open,
  onOpenChange,
}: DiscoverModelsDialogProps) {
  const discover = useDiscoverProviderModels(configId, open);
  const syncModels = useSyncProviderModels();
  const t = useTranslations("Provider");
  const tErrors = useTranslations("Errors");
  const tabPanelId = useId();
  const currentTabId = useId();
  const missingTabId = useId();
  const [kept, setKept] = useState<Set<string>>(
    () => new Set(existingModelIds),
  );
  const [activeTab, setActiveTab] = useState<DiscoveryTab>(TAB_CURRENT);
  const [query, setQuery] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const existingSet = new Set(existingModelIds);
  const servedModelIds = discover.data
    ? Array.from(new Set(discover.data.modelIds))
    : [];
  const servedSet = new Set(servedModelIds);
  const missingModelIds = discover.data
    ? existingModelIds.filter((id) => !servedSet.has(id))
    : [];

  const queryLower = query.trim().toLowerCase();
  const visibleModels =
    activeTab === TAB_CURRENT ? servedModelIds : missingModelIds;
  const filteredModelIds = queryLower
    ? visibleModels.filter((id) => id.toLowerCase().includes(queryLower))
    : visibleModels;

  const toAdd = Array.from(kept).filter((id) => !existingSet.has(id));
  const toRemove = existingModelIds.filter((id) => !kept.has(id));
  const hasChanges = toAdd.length > 0 || toRemove.length > 0;
  const allFilteredKept =
    filteredModelIds.length > 0 &&
    filteredModelIds.every((id) => kept.has(id));

  const tabs = [
    {
      id: currentTabId,
      key: TAB_CURRENT,
      label: t("tabCurrentLabel"),
      count: servedModelIds.length,
    },
    {
      id: missingTabId,
      key: TAB_MISSING,
      label: t("tabMissingLabel"),
      count: missingModelIds.length,
    },
  ] as const;

  const discoveryError = discover.isError
    ? apiErrorMessage(discover.error, tErrors, "actions.discoverModels")
    : null;

  function updateKept(ids: string[], checked: boolean) {
    setKept((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (checked) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      return next;
    });
  }

  async function onSync() {
    setSubmitError(null);
    try {
      await syncModels.mutateAsync({
        configId,
        input: { add: toAdd, remove: toRemove },
      });
      onOpenChange(false);
    } catch (caught) {
      setSubmitError(apiErrorMessage(caught, tErrors, "actions.syncModels"));
    }
  }

  function submitLabel(): string {
    if (syncModels.isPending) {
      return t("saving");
    }
    if (toAdd.length > 0 && toRemove.length > 0) {
      return t("saveChangesBoth", {
        addCount: toAdd.length,
        removeCount: toRemove.length,
      });
    }
    if (toAdd.length > 0) {
      return t("saveChangesAdd", { count: toAdd.length });
    }
    if (toRemove.length > 0) {
      return t("saveChangesRemove", { count: toRemove.length });
    }
    return t("saveChanges");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("addModelsTitle")}</DialogTitle>
          <DialogDescription>
            {t("addModelsDescription", { configName })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-3">
          {discover.isPending ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <RefreshCwIcon
                aria-hidden="true"
                className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
              />
              <span>{t("discovering")}</span>
            </div>
          ) : discoveryError && !discover.data ? (
            <div className="flex flex-col items-start gap-2.5">
              <p className="text-sm text-destructive">{discoveryError}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={discover.isFetching}
                onClick={() => void discover.refetch()}
              >
                {t("retry")}
              </Button>
            </div>
          ) : discover.data ? (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-border">
                <div role="tablist" className="flex min-w-0 items-center gap-4">
                  {tabs.map((tab) => {
                    const selected = activeTab === tab.key;
                    return (
                      <button
                        key={tab.key}
                        type="button"
                        role="tab"
                        id={tab.id}
                        aria-selected={selected}
                        aria-controls={tabPanelId}
                        onClick={() => setActiveTab(tab.key)}
                        className={cn(
                          "-mb-px inline-flex h-8 shrink-0 items-center gap-1.5 rounded-t-sm border-b-2 px-0.5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                          selected
                            ? "border-primary text-foreground"
                            : "border-transparent text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <span>{tab.label}</span>
                        {" "}
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-[11px] leading-none font-medium tabular-nums transition-colors",
                            selected
                              ? "bg-primary/12 text-foreground"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {tab.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <SharedTooltip
                  payload={t("refreshUpstream")}
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("refreshUpstream")}
                      disabled={discover.isFetching || syncModels.isPending}
                      onClick={() => void discover.refetch()}
                    />
                  }
                >
                  <RefreshCwIcon
                    aria-hidden="true"
                    className={cn(
                      "size-3.5",
                      discover.isFetching &&
                        "animate-spin motion-reduce:animate-none",
                    )}
                  />
                </SharedTooltip>
              </div>

              {discoveryError ? (
                <p className="text-sm text-destructive">{discoveryError}</p>
              ) : null}

              <div
                role="tabpanel"
                id={tabPanelId}
                aria-labelledby={
                  activeTab === TAB_CURRENT ? currentTabId : missingTabId
                }
                className="flex min-w-0 flex-col gap-2.5"
              >
                {activeTab === TAB_MISSING && missingModelIds.length > 0 ? (
                  <div className="flex items-start justify-between gap-2">
                    <p
                      className={cn(
                        "text-xs",
                        servedModelIds.length === 0
                          ? "text-destructive"
                          : "text-muted-foreground",
                      )}
                    >
                      {servedModelIds.length === 0
                        ? t("emptyUpstreamWarning")
                        : t("missingModelsHint")}
                    </p>
                    {filteredModelIds.length > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="shrink-0"
                        onClick={() =>
                          updateKept(filteredModelIds, !allFilteredKept)
                        }
                      >
                        {allFilteredKept ? t("uncheckAll") : t("keepAll")}
                      </Button>
                    ) : null}
                  </div>
                ) : null}

                {visibleModels.length > 0 ? (
                  <div className="relative">
                    <SearchIcon
                      aria-hidden="true"
                      className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                    />
                    <input
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={t("searchModelsPlaceholder")}
                      className="h-8 w-full rounded-lg border border-input bg-background pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                    />
                  </div>
                ) : null}

                {filteredModelIds.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">
                    {t(
                      queryLower
                        ? "noSearchResults"
                        : activeTab === TAB_CURRENT
                          ? "noUpstreamModels"
                          : "noMissingModels",
                    )}
                  </p>
                ) : (
                  <ul className="thin-scrollbar flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">
                    {filteredModelIds.map((modelId) => {
                      const isExisting = existingSet.has(modelId);
                      const checked = kept.has(modelId);
                      const willRemove = isExisting && !checked;
                      const badge =
                        !isExisting && checked
                          ? ROW_BADGE.add
                          : willRemove
                            ? ROW_BADGE.remove
                            : isExisting
                              ? ROW_BADGE.existing
                              : null;
                      return (
                        <li key={modelId}>
                          <button
                            type="button"
                            aria-pressed={checked}
                            onClick={() => updateKept([modelId], !checked)}
                            className={cn(
                              "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                              checked
                                ? "border-primary/60 bg-primary/10"
                                : willRemove
                                  ? "border-destructive/50 bg-destructive/5 hover:bg-destructive/10"
                                  : "border-border hover:bg-muted",
                            )}
                          >
                            <span
                              aria-hidden="true"
                              className={cn(
                                "flex size-4 shrink-0 items-center justify-center rounded-sm border transition-colors",
                                checked
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-input bg-background text-transparent",
                              )}
                            >
                              <CheckIcon
                                className="size-3.5"
                                strokeWidth={3}
                              />
                            </span>
                            <span className="min-w-0 flex-1 truncate">
                              {modelId}
                            </span>
                            {badge ? (
                              <span
                                className={cn(
                                  "shrink-0 text-xs",
                                  badge.className,
                                )}
                              >
                                {t(badge.key)}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          ) : null}

          {submitError ? (
            <p className="text-sm text-destructive">{submitError}</p>
          ) : null}
        </div>

        {discover.data ? (
          <DialogFooter>
            <Button
              type="button"
              disabled={
                !hasChanges || syncModels.isPending || discover.isFetching
              }
              onClick={() => void onSync()}
            >
              {submitLabel()}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
