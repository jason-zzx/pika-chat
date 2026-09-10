import type { AvailableModel } from "@/lib/schemas/provider";
import type { ComposerModelPick } from "@/stores/composer-store";

export type ModelGroup = {
  configId: string;
  configName: string;
  provenance: AvailableModel["provenance"];
  ownerName: string | null;
  models: AvailableModel[];
};

export function pairFromIds(
  configId: string | null | undefined,
  modelId: string | null | undefined,
): ComposerModelPick | null {
  if (!configId || !modelId) {
    return null;
  }
  return { configId, modelId };
}

export function sameModelPick(
  left: ComposerModelPick | null,
  right: ComposerModelPick | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.configId === right.configId && left.modelId === right.modelId;
}

export function findAvailableModel(
  available: AvailableModel[] | undefined,
  pick: ComposerModelPick | null,
): AvailableModel | undefined {
  if (!available || pick === null) {
    return undefined;
  }
  return available.find((model) => sameModelPick(model, pick));
}

export function groupAvailableModels(models: AvailableModel[]): ModelGroup[] {
  const groups = new Map<string, ModelGroup>();
  for (const model of models) {
    const existing = groups.get(model.configId);
    if (existing) {
      existing.models.push(model);
      continue;
    }
    groups.set(model.configId, {
      configId: model.configId,
      configName: model.configName,
      provenance: model.provenance,
      ownerName: model.ownerName,
      models: [model],
    });
  }
  return [...groups.values()];
}

export function modelMatchesQuery(model: AvailableModel, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return true;
  }
  return (
    model.modelId.toLowerCase().includes(needle) ||
    model.configName.toLowerCase().includes(needle)
  );
}

/**
 * Locale-agnostic heading for a provider-config group: the config name
 * alone, or the config name plus the sharing owner for instance-shared
 * configs. The caller resolves the copy through the `Chat.Pickers` catalog.
 */
type ModelGroupHeading =
  | { kind: "config"; configName: string }
  | { kind: "shared"; configName: string; ownerName: string | null };

export function modelGroupHeading(group: ModelGroup): ModelGroupHeading {
  if (group.provenance === "shared") {
    return {
      kind: "shared",
      configName: group.configName,
      ownerName: group.ownerName,
    };
  }
  return { kind: "config", configName: group.configName };
}
