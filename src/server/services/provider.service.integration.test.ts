import "server-only";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { newId } from "@/lib/id";
import { DEFAULT_MODEL_CONTEXT_TOKENS } from "@/lib/schemas/provider";
import { POST as postDiscover } from "@/app/api/providers/[id]/discover/route";
import { PATCH as patchProvider, DELETE as deleteProvider } from "@/app/api/providers/[id]/route";
import {
  POST as postProviderModel,
  PATCH as patchProviderModel,
  DELETE as deleteProviderModel,
} from "@/app/api/providers/[id]/models/route";
import { POST as postProvider } from "@/app/api/providers/route";
import { resetModelCatalogCache } from "@/server/ai/model-catalog";
import { resolveAvailableModels } from "@/server/ai/model-resolution";
import { requireActor } from "@/server/auth/actor";
import {
  adminCredentials,
  authPost,
  cookiesFrom,
  jsonRequest,
  otherAdminCredentials,
  postSetup,
  readJson,
  userCredentials,
} from "@/server/auth/auth-test-helpers";
import * as crypto from "@/server/crypto";
import { getDb } from "@/server/db/client";
import {
  APP_SETTINGS_ROW_ID,
  accounts,
  appSettings,
  providerConfigs,
  providerModels,
  sessions,
  users,
  verifications,
} from "@/server/db/schema";
import {
  addProviderModel,
  createProviderConfig,
  deleteProviderConfig,
  listProviderConfigs,
  updateProviderConfig,
  updateProviderModel,
} from "@/server/services/provider.service";

const db = getDb();

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  throw new Error("expected an object");
}

function errorCode(payload: unknown): string {
  const nested = asObject(payload).error;
  if (typeof nested === "object" && nested !== null && "code" in nested) {
    const code = nested.code;
    if (typeof code === "string") {
      return code;
    }
  }
  throw new Error("expected error.code");
}

function stubModelsDevCatalog(body: unknown): () => void {
  const previous = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.includes("models.dev")) {
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return previous(input, init);
  }) as typeof fetch;
  resetModelCatalogCache();
  return () => {
    globalThis.fetch = previous;
    resetModelCatalogCache();
  };
}

function gpt4oCatalog() {
  return {
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
  };
}

async function resetState(): Promise<void> {
  await db.delete(providerModels);
  await db.delete(providerConfigs);
  await db.delete(sessions);
  await db.delete(accounts);
  await db.delete(verifications);
  await db.delete(users);
  await db
    .update(appSettings)
    .set({ allowRegistration: false, updatedAt: new Date() })
    .where(eq(appSettings.id, APP_SETTINGS_ROW_ID));
}

async function adminCreateUser(
  cookie: string,
  input: {
    username: string;
    email: string;
    password: string;
    role: "admin" | "user";
  },
): Promise<Response> {
  return authPost(
    jsonRequest("/api/auth/admin/create-user", {
      cookie,
      body: {
        email: input.email,
        password: input.password,
        name: input.username,
        role: input.role,
        data: { username: input.username },
      },
    }),
  );
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await authPost(
    jsonRequest("/api/auth/sign-in/email", { body: { email, password } }),
  );
  expect(response.status).toBe(200);
  return cookiesFrom(response);
}

async function actorFromCookie(cookie: string) {
  return requireActor(jsonRequest("/api/providers", { cookie }).headers);
}

async function seedActors() {
  const setup = await postSetup(
    jsonRequest("/api/setup", { body: adminCredentials }),
  );
  expect(setup.status).toBe(201);
  const superCookie = cookiesFrom(setup);

  const createdMember = await adminCreateUser(superCookie, {
    ...userCredentials,
    role: "user",
  });
  expect(createdMember.status).toBe(200);
  const createdOtherAdmin = await adminCreateUser(superCookie, {
    ...otherAdminCredentials,
    role: "admin",
  });
  expect(createdOtherAdmin.status).toBe(200);

  const userCookie = await signIn(
    userCredentials.email,
    userCredentials.password,
  );
  const otherAdminCookie = await signIn(
    otherAdminCredentials.email,
    otherAdminCredentials.password,
  );

  return {
    superActor: await actorFromCookie(superCookie),
    userActor: await actorFromCookie(userCookie),
    userCookie,
    otherAdminCookie,
  };
}

describe("provider.service", () => {
  beforeEach(async () => {
    await resetState();
    resetModelCatalogCache();
  });

  afterAll(async () => {
    await resetState();
  });

  it("coerces a regular user's shared visibility to private on create and update", async () => {
    const { userActor, userCookie } = await seedActors();
    const created = await createProviderConfig(
      {
        name: "user-byok",
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-user-key",
        visibility: "shared",
      },
      userActor,
    );
    expect(created.visibility).toBe("private");

    const viaRoute = await postProvider(
      jsonRequest("/api/providers", {
        cookie: userCookie,
        body: {
          name: "user-byok-route",
          baseUrl: "https://api.example.com/v1",
          visibility: "shared",
        },
      }),
    );
    expect(viaRoute.status).toBe(201);
    expect(asObject(await readJson(viaRoute)).visibility).toBe("private");

    const updated = await updateProviderConfig(
      created.id,
      { visibility: "shared" },
      userActor,
    );
    expect(updated.visibility).toBe("private");

    const patched = await patchProvider(
      jsonRequest(`/api/providers/${created.id}`, {
        method: "PATCH",
        cookie: userCookie,
        body: { visibility: "shared" },
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(patched.status).toBe(200);
    expect(asObject(await readJson(patched)).visibility).toBe("private");
  });

  it("lets an admin create a shared config that a user can resolve", async () => {
    const { superActor, userActor } = await seedActors();
    const shared = await createProviderConfig(
      {
        name: "instance-openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-admin-key",
        visibility: "shared",
      },
      superActor,
    );
    expect(shared.visibility).toBe("shared");
    await addProviderModel(
      shared.id,
      { modelId: "gpt-4o" },
      superActor,
    );

    const listed = await listProviderConfigs(userActor);
    expect(listed.own).toEqual([]);
    expect(listed.shared).toHaveLength(1);
    const visible = listed.shared[0];
    expect(visible?.name).toBe("instance-openai");
    expect(visible?.models.map((model) => model.modelId)).toEqual(["gpt-4o"]);

    const resolved = await resolveAvailableModels(userActor);
    expect(resolved).toEqual([
      expect.objectContaining({
        configId: shared.id,
        configName: "instance-openai",
        modelId: "gpt-4o",
        provenance: "shared",
      }),
    ]);
  });

  it("returns a last-four mask and never decrypts on list", async () => {
    const { userActor } = await seedActors();
    const decrypt = vi.spyOn(crypto, "decryptSecret");
    await createProviderConfig(
      {
        name: "masked",
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-test-abcd",
        visibility: "private",
      },
      userActor,
    );
    const listed = await listProviderConfigs(userActor);
    expect(listed.own[0]?.apiKeyLastFour).toBe("abcd");
    expect(listed.own[0]?.apiKeyLastFour?.length).toBeLessThanOrEqual(4);
    expect(decrypt).not.toHaveBeenCalled();
    decrypt.mockRestore();
  });

  it("hides baseUrl and the key mask from non-owners of a shared config", async () => {
    const { superActor, userActor } = await seedActors();
    await createProviderConfig(
      {
        name: "shared-hidden-creds",
        baseUrl: "https://secret.example.com/v1",
        apiKey: "sk-hidden-key",
        visibility: "shared",
      },
      superActor,
    );
    const listed = await listProviderConfigs(userActor);
    const shared = listed.shared[0];
    expect(shared).toBeDefined();
    expect(shared).not.toHaveProperty("baseUrl");
    expect(shared).not.toHaveProperty("apiKeyLastFour");
    expect(JSON.stringify(shared)).not.toContain("secret.example.com");
    expect(JSON.stringify(shared)).not.toContain("sk-hidden");
  });

  it("returns 404, not 403, for mutations against someone else's config", async () => {
    const { superActor, userCookie, otherAdminCookie } = await seedActors();
    const shared = await createProviderConfig(
      {
        name: "owned-by-super",
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-super",
        visibility: "shared",
      },
      superActor,
    );

    const context = { params: Promise.resolve({ id: shared.id }) };

    const userPatch = await patchProvider(
      jsonRequest(`/api/providers/${shared.id}`, {
        method: "PATCH",
        cookie: userCookie,
        body: { name: "hijack" },
      }),
      context,
    );
    expect(userPatch.status).toBe(404);
    expect(errorCode(await readJson(userPatch))).toBe("NOT_FOUND");

    const adminPatch = await patchProvider(
      jsonRequest(`/api/providers/${shared.id}`, {
        method: "PATCH",
        cookie: otherAdminCookie,
        body: { name: "hijack" },
      }),
      context,
    );
    expect(adminPatch.status).toBe(404);
    expect(errorCode(await readJson(adminPatch))).toBe("NOT_FOUND");

    const discover = await postDiscover(
      jsonRequest(`/api/providers/${shared.id}/discover`, {
        cookie: otherAdminCookie,
      }),
      context,
    );
    expect(discover.status).toBe(404);

    const add = await postProviderModel(
      jsonRequest(`/api/providers/${shared.id}/models`, {
        cookie: otherAdminCookie,
        body: { modelId: "gpt-4o" },
      }),
      context,
    );
    expect(add.status).toBe(404);

    const remove = await deleteProviderModel(
      jsonRequest(
        `/api/providers/${shared.id}/models?modelId=${encodeURIComponent("gpt-4o")}`,
        {
          method: "DELETE",
          cookie: otherAdminCookie,
        },
      ),
      context,
    );
    expect(remove.status).toBe(404);

    const deleted = await deleteProvider(
      jsonRequest(`/api/providers/${shared.id}`, {
        method: "DELETE",
        cookie: otherAdminCookie,
      }),
      context,
    );
    expect(deleted.status).toBe(404);
    expect(errorCode(await readJson(deleted))).toBe("NOT_FOUND");
  });

  it("adds a model by hand without discovery", async () => {
    const { userActor, userCookie } = await seedActors();
    const config = await createProviderConfig(
      {
        name: "manual",
        baseUrl: "https://relay.example.com/v1",
        visibility: "private",
      },
      userActor,
    );
    const model = await addProviderModel(
      config.id,
      { modelId: "local-llama" },
      userActor,
    );
    expect(model.modelId).toBe("local-llama");
    const listed = await listProviderConfigs(userActor);
    expect(listed.own[0]?.models.map((entry) => entry.modelId)).toEqual([
      "local-llama",
    ]);
    const resolved = await resolveAvailableModels(userActor);
    expect(resolved.map((entry) => entry.modelId)).toEqual(["local-llama"]);

    const slashed = await addProviderModel(
      config.id,
      { modelId: "openai/gpt-4o" },
      userActor,
    );
    expect(slashed.modelId).toBe("openai/gpt-4o");
    const remove = await deleteProviderModel(
      jsonRequest(
        `/api/providers/${config.id}/models?modelId=${encodeURIComponent("openai/gpt-4o")}`,
        { method: "DELETE", cookie: userCookie },
      ),
      { params: Promise.resolve({ id: config.id }) },
    );
    expect(remove.status).toBe(204);
    const after = await resolveAvailableModels(userActor);
    expect(after.map((entry) => entry.modelId)).toEqual(["local-llama"]);
  });

  it("deletes a config and its models", async () => {
    const { userActor } = await seedActors();
    const config = await createProviderConfig(
      {
        name: "to-delete",
        baseUrl: "https://api.example.com/v1",
        visibility: "private",
      },
      userActor,
    );
    await addProviderModel(config.id, { modelId: "gone" }, userActor);
    await deleteProviderConfig(config.id, userActor);
    const listed = await listProviderConfigs(userActor);
    expect(listed.own).toEqual([]);
    await expect(
      updateProviderConfig(config.id, { name: "nope" }, userActor),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("fills unmatched adds with defaults and catalog hits from models.dev", async () => {
    const { userActor } = await seedActors();
    const config = await createProviderConfig(
      {
        name: "manual",
        baseUrl: "https://relay.example.com/v1",
        visibility: "private",
      },
      userActor,
    );

    const missed = await addProviderModel(
      config.id,
      { modelId: "local-llama" },
      userActor,
    );
    expect(missed).toMatchObject({
      modelId: "local-llama",
      contextTokens: DEFAULT_MODEL_CONTEXT_TOKENS,
      inputModalities: ["text"],
      outputModalities: ["text"],
      reasoning: false,
      reasoningOptions: [],
      metadataSource: "default",
    });

    const restore = stubModelsDevCatalog(gpt4oCatalog());
    try {
      const hit = await addProviderModel(
        config.id,
        { modelId: "gpt-4o" },
        userActor,
      );
      expect(hit).toMatchObject({
        modelId: "gpt-4o",
        contextTokens: 128000,
        outputTokens: 16384,
        inputModalities: ["text", "image"],
        reasoning: false,
        vendorKey: "openai",
        metadataSource: "catalog",
      });
    } finally {
      restore();
    }
  });

  it("lets the owner patch metadata and returns NOT_FOUND for everyone else", async () => {
    const { superActor, userActor, userCookie, otherAdminCookie } =
      await seedActors();
    const config = await createProviderConfig(
      {
        name: "owned",
        baseUrl: "https://api.example.com/v1",
        visibility: "private",
      },
      userActor,
    );
    await addProviderModel(config.id, { modelId: "local-llama" }, userActor);

    const patched = await patchProviderModel(
      jsonRequest(
        `/api/providers/${config.id}/models?modelId=${encodeURIComponent("local-llama")}`,
        {
          method: "PATCH",
          cookie: userCookie,
          body: {
            contextTokens: 32000,
            reasoning: true,
            vendorKey: "meta",
          },
        },
      ),
      { params: Promise.resolve({ id: config.id }) },
    );
    expect(patched.status).toBe(200);
    expect(asObject(await readJson(patched))).toMatchObject({
      contextTokens: 32000,
      reasoning: true,
      reasoningOptions: ["low", "medium", "high"],
      vendorKey: "meta",
      metadataSource: "user",
    });

    const shared = await createProviderConfig(
      {
        name: "shared-meta",
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-admin",
        visibility: "shared",
      },
      superActor,
    );
    await addProviderModel(shared.id, { modelId: "gpt-4o" }, superActor);
    const hijack = await patchProviderModel(
      jsonRequest(
        `/api/providers/${shared.id}/models?modelId=${encodeURIComponent("gpt-4o")}`,
        {
          method: "PATCH",
          cookie: otherAdminCookie,
          body: { reasoning: true },
        },
      ),
      { params: Promise.resolve({ id: shared.id }) },
    );
    expect(hijack.status).toBe(404);
    expect(errorCode(await readJson(hijack))).toBe("NOT_FOUND");
  });

  it("lazy-fills unsourced rows once and does not overwrite user rows", async () => {
    const { userActor } = await seedActors();
    const config = await createProviderConfig(
      {
        name: "legacy",
        baseUrl: "https://relay.example.com/v1",
        visibility: "private",
      },
      userActor,
    );

    const unsourcedId = newId();
    await db.insert(providerModels).values({
      id: unsourcedId,
      providerConfigId: config.id,
      modelId: "legacy-id",
    });

    const listed = await listProviderConfigs(userActor);
    const filled = listed.own[0]?.models.find(
      (model) => model.modelId === "legacy-id",
    );
    expect(filled).toMatchObject({
      contextTokens: DEFAULT_MODEL_CONTEXT_TOKENS,
      metadataSource: "default",
    });
    const persisted = await db
      .select({
        metadataSource: providerModels.metadataSource,
      })
      .from(providerModels)
      .where(eq(providerModels.id, unsourcedId));
    expect(persisted[0]?.metadataSource).toBe("default");

    await addProviderModel(config.id, { modelId: "kept-user" }, userActor);
    const userRow = await updateProviderModel(
      config.id,
      "kept-user",
      { contextTokens: 111, reasoning: true },
      userActor,
    );
    expect(userRow.metadataSource).toBe("user");

    const restore = stubModelsDevCatalog({
      openai: {
        id: "openai",
        models: {
          "kept-user": {
            reasoning: false,
            modalities: { input: ["text"], output: ["text"] },
            limit: { context: 999 },
          },
        },
      },
    });
    try {
      const again = await listProviderConfigs(userActor);
      const kept = again.own[0]?.models.find(
        (model) => model.modelId === "kept-user",
      );
      expect(kept).toMatchObject({
        contextTokens: 111,
        reasoning: true,
        metadataSource: "user",
      });
    } finally {
      restore();
    }
  });

  it("resets metadata from the catalog when the owner asks", async () => {
    const { userActor } = await seedActors();
    const config = await createProviderConfig(
      {
        name: "reset",
        baseUrl: "https://relay.example.com/v1",
        visibility: "private",
      },
      userActor,
    );
    await addProviderModel(config.id, { modelId: "gpt-4o" }, userActor);
    await updateProviderModel(
      config.id,
      "gpt-4o",
      { contextTokens: 42, reasoning: true, vendorKey: "meta" },
      userActor,
    );

    const restore = stubModelsDevCatalog(gpt4oCatalog());
    try {
      const reset = await updateProviderModel(
        config.id,
        "gpt-4o",
        { resetFromCatalog: true },
        userActor,
      );
      expect(reset).toMatchObject({
        contextTokens: 128000,
        outputTokens: 16384,
        inputModalities: ["text", "image"],
        vendorKey: "openai",
        metadataSource: "catalog",
        reasoning: false,
      });
    } finally {
      restore();
    }
  });

  it("upgrades default rows when a later catalog lookup hits", async () => {
    const { userActor } = await seedActors();
    const config = await createProviderConfig(
      {
        name: "stale-default",
        baseUrl: "https://relay.example.com/v1",
        visibility: "private",
      },
      userActor,
    );
    const staleId = newId();
    await db.insert(providerModels).values({
      id: staleId,
      providerConfigId: config.id,
      modelId: "gpt-4o",
      metadataSource: "default",
    });

    const restore = stubModelsDevCatalog(gpt4oCatalog());
    try {
      const listed = await listProviderConfigs(userActor);
      const gpt = listed.own[0]?.models.find(
        (model) => model.modelId === "gpt-4o",
      );
      expect(gpt).toMatchObject({
        contextTokens: 128000,
        outputTokens: 16384,
        inputModalities: ["text", "image"],
        vendorKey: "openai",
        metadataSource: "catalog",
      });
    } finally {
      restore();
    }
  });
});
