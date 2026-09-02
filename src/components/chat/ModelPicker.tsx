"use client";

import { useAvailableModels } from "@/components/provider/use-available-models";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AvailableModel } from "@/lib/schemas/provider";
import type { ComposerModelPick } from "@/stores/composer-store";

const NONE_VALUE = "none";

function encodeModel(configId: string, modelId: string): string {
  return `${configId}::${modelId}`;
}

function decodeModel(value: string): ComposerModelPick | null {
  if (value === NONE_VALUE || value.length === 0) {
    return null;
  }
  const separator = value.indexOf("::");
  if (separator <= 0) {
    return null;
  }
  return {
    configId: value.slice(0, separator),
    modelId: value.slice(separator + 2),
  };
}

function modelLabel(model: AvailableModel): string {
  if (model.provenance === "shared") {
    const who = model.ownerName ?? "another user";
    return `${model.modelId} · ${model.configName} (shared by ${who})`;
  }
  return `${model.modelId} · ${model.configName}`;
}

type ModelPickerProps = {
  value: ComposerModelPick | null;
  onChange: (value: ComposerModelPick | null) => void;
  disabled?: boolean;
};

export default function ModelPicker({
  value,
  onChange,
  disabled = false,
}: ModelPickerProps) {
  const models = useAvailableModels();
  const available = models.data ?? [];
  const encoded = value ? encodeModel(value.configId, value.modelId) : NONE_VALUE;
  const selected = available.find(
    (model) => encodeModel(model.configId, model.modelId) === encoded,
  );
  const selectValue = selected ? encoded : NONE_VALUE;

  return (
    <Select
      value={selectValue}
      onValueChange={(next) => {
        if (typeof next === "string") {
          onChange(decodeModel(next));
        }
      }}
      disabled={disabled || models.isPending}
    >
      <SelectTrigger
        className="max-w-full"
        size="sm"
        aria-label="Model"
      >
        <SelectValue placeholder="Select a model">
          {selected ? modelLabel(selected) : "Select a model"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE_VALUE}>Select a model</SelectItem>
        {available.map((model) => (
          <SelectItem
            key={encodeModel(model.configId, model.modelId)}
            value={encodeModel(model.configId, model.modelId)}
          >
            {modelLabel(model)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
