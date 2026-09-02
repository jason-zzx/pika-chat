"use client";

import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";

import { useAvailableModels } from "@/components/provider/use-available-models";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ComposerModelPick } from "@/stores/composer-store";

import {
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
};

export default function ModelPicker({
  value,
  onChange,
  disabled = false,
  allowClear = false,
  id,
}: ModelPickerProps) {
  const models = useAvailableModels();
  const available = models.data ?? [];
  const selected = available.find(
    (model) =>
      value !== null &&
      model.configId === value.configId &&
      model.modelId === value.modelId,
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = available.filter((model) => modelMatchesQuery(model, query));
  const groups = groupAvailableModels(filtered);
  const pickerDisabled = disabled || models.isPending;

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
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="max-w-full justify-between gap-1.5 font-normal"
          />
        }
      >
        <span className="truncate">
          {selected ? selected.modelId : "Select a model"}
        </span>
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
                  return (
                    <button
                      key={`${model.configId}::${model.modelId}`}
                      type="button"
                      className={cn(
                        "w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                        isSelected && "bg-accent text-accent-foreground",
                      )}
                      onClick={() => closeAndSelect(pick)}
                    >
                      {model.modelId}
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
