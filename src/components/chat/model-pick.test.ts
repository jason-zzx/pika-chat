import { describe, expect, it } from "vitest";

import {
  defaultModelMetadata,
  type AvailableModel,
} from "@/lib/schemas/provider";

import {
  groupAvailableModels,
  modelGroupHeading,
  modelMatchesQuery,
  pairFromIds,
  sameModelPick,
} from "./model-pick";

const ownLlama: AvailableModel = {
  configId: "cfg-own",
  configName: "my-keys",
  modelId: "local-llama",
  provenance: "own",
  ownerName: null,
  ...defaultModelMetadata(),
};

const ownOther: AvailableModel = {
  configId: "cfg-own",
  configName: "my-keys",
  modelId: "other-model",
  provenance: "own",
  ownerName: null,
  ...defaultModelMetadata(),
};

const sharedGpt: AvailableModel = {
  configId: "cfg-shared",
  configName: "instance-openai",
  modelId: "gpt-4o",
  provenance: "shared",
  ownerName: "operator",
  ...defaultModelMetadata(),
};

describe("pairFromIds", () => {
  it("returns a pick only when both ids are present", () => {
    expect(pairFromIds("cfg", "llama")).toEqual({
      configId: "cfg",
      modelId: "llama",
    });
    expect(pairFromIds(null, "llama")).toBeNull();
    expect(pairFromIds("cfg", undefined)).toBeNull();
  });
});

describe("sameModelPick", () => {
  it("compares config and model ids", () => {
    expect(
      sameModelPick(
        { configId: "a", modelId: "m" },
        { configId: "a", modelId: "m" },
      ),
    ).toBe(true);
    expect(
      sameModelPick(
        { configId: "a", modelId: "m" },
        { configId: "b", modelId: "m" },
      ),
    ).toBe(false);
    expect(sameModelPick(null, null)).toBe(true);
    expect(sameModelPick({ configId: "a", modelId: "m" }, null)).toBe(false);
  });
});

describe("groupAvailableModels", () => {
  it("groups by configId and keeps first-seen order", () => {
    const groups = groupAvailableModels([ownLlama, sharedGpt, ownOther]);
    expect(groups).toHaveLength(2);
    const ownGroup = groups.find((group) => group.configId === "cfg-own");
    const sharedGroup = groups.find((group) => group.configId === "cfg-shared");
    expect(ownGroup?.models.map((model) => model.modelId)).toEqual([
      "local-llama",
      "other-model",
    ]);
    expect(
      ownGroup ? modelGroupHeading(ownGroup) : null,
    ).toEqual({ kind: "config", configName: "my-keys" });
    expect(
      sharedGroup ? modelGroupHeading(sharedGroup) : null,
    ).toEqual({
      kind: "shared",
      configName: "instance-openai",
      ownerName: "operator",
    });
  });
});

describe("modelMatchesQuery", () => {
  it("matches model id and config name case-insensitively", () => {
    expect(modelMatchesQuery(ownLlama, "")).toBe(true);
    expect(modelMatchesQuery(ownLlama, "  LLaMA ")).toBe(true);
    expect(modelMatchesQuery(ownLlama, "MY-KEYS")).toBe(true);
    expect(modelMatchesQuery(ownLlama, "gpt")).toBe(false);
  });

  it("keeps every model in a config when the query hits the config name", () => {
    const filtered = [ownLlama, ownOther, sharedGpt].filter((model) =>
      modelMatchesQuery(model, "my-keys"),
    );
    expect(filtered.map((model) => model.modelId)).toEqual([
      "local-llama",
      "other-model",
    ]);
  });
});
