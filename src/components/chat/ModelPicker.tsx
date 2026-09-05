"use client";

import { BrainIcon, ChevronDownIcon, EyeIcon } from "lucide-react";
import { useState } from "react";

import { useAvailableModels } from "@/components/provider/use-available-models";
import ModelVendorIcon from "@/components/provider/ModelVendorIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  formatContextTokens,
  modelHasVision,
} from "@/lib/model-vendor";
import { cn } from "@/lib/utils";
import type { ComposerModelPick } from "@/stores/composer-store";

import {
  findAvailableModel,
  groupAvailableModels,
  modelGroupHeading,
  modelMatchesQuery,
  sameModelPick,
} from "./model-pick";

type ModelPickerProps = {
  value: ComposerModelPick | null;
  onChange: (value: ComposerModelPick | null) => void;
  disabled?: boolean;
  allowClear?: boolean;
  id?: string;
  /** Show only the vendor icon in the collapsed trigger. */
  iconOnly?: boolean;
};

export default function ModelPicker({
  value,
  onChange,
  disabled = false,
  allowClear = false,
  id,
  iconOnly = false,
}: ModelPickerProps) {
  const models = useAvailableModels();
  const available = models.data ?? [];
  const selected = findAvailableModel(available, value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = available.filter((model) => modelMatchesQuery(model, query));
  const groups = groupAvailableModels(filtered);
  const pickerDisabled = disabled || models.isPending;
  const triggerLabel = selected ? selected.modelId : "Select a model";

  function closeAndSelect(next: ComposerModelPick | null) {
    onChange(next);
    setOpen(false);
    setQuery("");
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setQuery("");
        }
      }}
    >
      <PopoverTrigger
        id={id}
        disabled={pickerDisabled}
        aria-label={iconOnly ? triggerLabel : undefined}
        title={
          iconOnly && selected
            ? `${selected.modelId} · ${selected.configName}`
            : undefined
        }
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            // bg-transparent matches the Select-based pickers on the muted
            // composer container (outline variant defaults to bg-background).
            className="max-w-full justify-between gap-1.5 bg-transparent font-normal"
          />
        }
      >
        {iconOnly ? (
          <ModelVendorIcon
            modelId={selected?.modelId ?? ""}
            vendorKey={selected?.vendorKey ?? null}
          />
        ) : (
          <span className="flex min-w-0 items-center gap-1.5 truncate">
            {selected ? (
              <>
                <ModelVendorIcon
                  modelId={selected.modelId}
                  vendorKey={selected.vendorKey}
                />
                <span className="truncate">{selected.modelId}</span>
              </>
            ) : (
              "Select a model"
            )}
          </span>
        )}
        <ChevronDownIcon aria-hidden="true" className="size-4 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 gap-2 p-2"
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            event.target instanceof HTMLInputElement
          ) {
            event.preventDefault();
          }
        }}
      >
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search models"
          aria-label="Search models"
          autoComplete="off"
        />
        <div className="max-h-64 overflow-y-auto">
          {allowClear ? (
            <button
              type="button"
              className={cn(
                "mb-1 w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                value === null && "bg-accent text-accent-foreground",
              )}
              onClick={() => closeAndSelect(null)}
            >
              No default model
            </button>
          ) : null}
          {available.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              No models available
            </p>
          ) : groups.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              No matching models
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.configId} className="mb-1">
                <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
                  {modelGroupHeading(group)}
                </p>
                {group.models.map((model) => {
                  const pick = {
                    configId: model.configId,
                    modelId: model.modelId,
                  };
                  const isSelected = sameModelPick(value, pick);
                  const contextLabel = formatContextTokens(model.contextTokens);
                  const hasVision = modelHasVision(model.inputModalities);
                  const hasCues =
                    contextLabel !== null || hasVision || model.reasoning;
                  return (
                    <button
                      key={`${model.configId}::${model.modelId}`}
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                        isSelected && "bg-accent text-accent-foreground",
                      )}
                      onClick={() => closeAndSelect(pick)}
                    >
                      <ModelVendorIcon
                        modelId={model.modelId}
                        vendorKey={model.vendorKey}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {model.modelId}
                      </span>
                      {hasCues ? (
                        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                          {contextLabel !== null ? (
                            <span>{contextLabel}</span>
                          ) : null}
                          {hasVision ? (
                            <span title="Vision" className="flex items-center">
                              <EyeIcon
                                aria-hidden="true"
                                className="size-3.5"
                              />
                              <span className="sr-only">Vision</span>
                            </span>
                          ) : null}
                          {model.reasoning ? (
                            <span title="Reasoning" className="flex items-center">
                              <BrainIcon
                                aria-hidden="true"
                                className="size-3.5"
                              />
                              <span className="sr-only">Reasoning</span>
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
