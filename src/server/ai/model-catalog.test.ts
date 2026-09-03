import { afterEach, describe, expect, it, vi } from "vitest";

import { fillMetadataForModelId, resetModelCatalogCache } from "./model-catalog";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetModelCatalogCache();
});

function catalogPayload() {
  return {
    openai: {
      id: "openai",
      models: {
        "gpt-4o": {
          reasoning: false,
          modalities: { input: ["text", "image"], output: ["text"] },
          limit: { context: 128000, output: 16384 },
        },
        "gpt-5": {
          reasoning: true,
          reasoning_options: [
            { type: "effort", values: ["minimal", "low", "medium", "high"] },
          ],
          modalities: { input: ["text"], output: ["text"] },
          limit: { context: 400000, output: 128000 },
        },
      },
    },
    alibaba: {
      id: "alibaba",
      models: {
        "qwen-max": {
          reasoning: false,
          modalities: { input: ["text"], output: ["text"] },
          limit: { context: 32000 },
        },
      },
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fillMetadataForModelId", () => {
  it("maps an exact catalog hit", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(catalogPayload()));

    await expect(fillMetadataForModelId("gpt-5")).resolves.toEqual({
      contextTokens: 400000,
      outputTokens: 128000,
      inputModalities: ["text"],
      outputModalities: ["text"],
      reasoning: true,
      reasoningOptions: ["minimal", "low", "medium", "high"],
      vendorKey: "openai",
      metadataSource: "catalog",
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("matches a slashed id by suffix", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(catalogPayload()));

    await expect(fillMetadataForModelId("Qwen/qwen-max")).resolves.toMatchObject({
      contextTokens: 32000,
      vendorKey: "alibaba",
      metadataSource: "catalog",
    });
  });

  it("returns unmatched defaults when the id is absent", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(catalogPayload()));

    await expect(fillMetadataForModelId("local-llama")).resolves.toEqual({
      contextTokens: 256000,
      outputTokens: 65536,
      inputModalities: ["text"],
      outputModalities: ["text"],
      reasoning: false,
      reasoningOptions: [],
      vendorKey: null,
      metadataSource: "default",
    });
  });

  it("returns unmatched defaults on timeout without throwing", async () => {
    globalThis.fetch = async () => {
      const error = new Error("The operation was aborted");
      error.name = "TimeoutError";
      throw error;
    };

    await expect(fillMetadataForModelId("gpt-4o")).resolves.toMatchObject({
      metadataSource: "default",
      contextTokens: 256000,
      reasoning: false,
    });
  });

  it("returns unmatched defaults on a non-JSON body", async () => {
    globalThis.fetch = async () =>
      new Response("<html>gateway</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });

    await expect(fillMetadataForModelId("gpt-4o")).resolves.toMatchObject({
      metadataSource: "default",
    });
  });

  it("reuses the in-memory catalog on a second lookup", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(catalogPayload()));

    await fillMetadataForModelId("gpt-4o");
    await fillMetadataForModelId("gpt-5");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("still matches when another model has null effort values", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        sarvam: {
          id: "sarvam",
          models: {
            "sarvam-105b": {
              reasoning: true,
              reasoning_options: [
                { type: "effort", values: [null, "low", "medium"] },
              ],
              modalities: { input: ["text"], output: ["text"] },
              limit: { context: 8000 },
            },
          },
        },
        openai: {
          id: "openai",
          models: {
            "gpt-4o": {
              reasoning: false,
              modalities: { input: ["text", "image"], output: ["text"] },
              limit: { context: 128000, output: 16384 },
            },
          },
        },
      }),
    );

    await expect(fillMetadataForModelId("gpt-4o")).resolves.toMatchObject({
      contextTokens: 128000,
      outputTokens: 16384,
      metadataSource: "catalog",
      vendorKey: "openai",
    });
  });

  it("prefers a first-party catalog row over a reseller with the same id", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        cortecs: {
          id: "cortecs",
          models: {
            "gpt-4o": {
              reasoning: false,
              modalities: { input: ["text"], output: ["text"] },
              limit: { context: 1, output: 1 },
            },
          },
        },
        openai: {
          id: "openai",
          models: {
            "gpt-4o": {
              reasoning: false,
              modalities: { input: ["text", "image"], output: ["text"] },
              limit: { context: 128000, output: 16384 },
            },
          },
        },
      }),
    );

    await expect(fillMetadataForModelId("gpt-4o")).resolves.toMatchObject({
      contextTokens: 128000,
      outputTokens: 16384,
      vendorKey: "openai",
      metadataSource: "catalog",
    });
  });

  it("breaks a tied first-party match by the model id's own vendor", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        sensenova: {
          id: "sensenova",
          models: {
            "glm-5.2": {
              reasoning: true,
              reasoning_options: [{ type: "effort", values: ["low", "high"] }],
              modalities: { input: ["text"], output: ["text"] },
              limit: { context: 1, output: 1 },
            },
          },
        },
        zhipuai: {
          id: "zhipuai",
          models: {
            "glm-5.2": {
              reasoning: true,
              reasoning_options: [{ type: "effort", values: ["low", "high"] }],
              modalities: { input: ["text"], output: ["text"] },
              limit: { context: 202000, output: 128000 },
            },
          },
        },
      }),
    );

    // Both providers score 260 for the exact id and sensenova comes first in
    // key order; the tie must resolve to zhipuai, whose vendor matches what
    // "glm-5.2" itself implies.
    await expect(fillMetadataForModelId("glm-5.2")).resolves.toMatchObject({
      contextTokens: 202000,
      outputTokens: 128000,
      vendorKey: "zhipuai",
      metadataSource: "catalog",
    });
  });

  it("matches a bare id to a slashed catalog key and maps the lab vendor", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        "hpc-ai": {
          id: "hpc-ai",
          models: {
            "deepseek/deepseek-v4-flash": {
              reasoning: true,
              reasoning_options: [
                { type: "toggle" },
                { type: "effort", values: ["low", "high", "max"] },
              ],
              modalities: { input: ["text"], output: ["text"] },
              limit: { context: 1000000, output: 384000 },
            },
          },
        },
      }),
    );

    await expect(fillMetadataForModelId("deepseek-v4-flash")).resolves.toEqual({
      contextTokens: 1000000,
      outputTokens: 384000,
      inputModalities: ["text"],
      outputModalities: ["text"],
      reasoning: true,
      reasoningOptions: ["low", "high", "max"],
      vendorKey: "deepseek",
      metadataSource: "catalog",
    });
  });
});
