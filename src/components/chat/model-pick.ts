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

export function modelGroupHeading(group: ModelGroup): string {
  if (group.provenance === "shared") {
    const who = group.ownerName ?? "another user";
    return `${group.configName} (shared by ${who})`;
  }
  return group.configName;
}
