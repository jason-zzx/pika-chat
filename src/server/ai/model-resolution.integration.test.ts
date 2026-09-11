import "server-only";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { GET as getModels } from "@/app/api/models/route";
import { resolveAvailableModels } from "@/server/ai/model-resolution";
import { requireActor } from "@/server/auth/actor";
import {
  adminCredentials,
  authPost,
  cookiesFrom,
  jsonRequest,
  postSetup,
  readJson,
  userCredentials,
} from "@/server/auth/auth-test-helpers";
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
} from "@/server/services/provider.service";

const db = getDb();

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

async function seedActors() {
  const setup = await postSetup(
    jsonRequest("/api/setup", { body: adminCredentials }),
  );
  expect(setup.status).toBe(201);
  const superCookie = cookiesFrom(setup);
  const createdMember = await authPost(
    jsonRequest("/api/auth/admin/create-user", {
      cookie: superCookie,
      body: {
        email: userCredentials.email,
        password: userCredentials.password,
        name: userCredentials.username,
        role: "user",
        data: { username: userCredentials.username },
      },
    }),
  );
  expect(createdMember.status).toBe(200);
  const userSignIn = await authPost(
    jsonRequest("/api/auth/sign-in/email", {
      body: {
        email: userCredentials.email,
        password: userCredentials.password,
      },
    }),
  );
  expect(userSignIn.status).toBe(200);
  const userCookie = cookiesFrom(userSignIn);
  return {
    superActor: await requireActor(
      jsonRequest("/api/models", { cookie: superCookie }).headers,
    ),
    userActor: await requireActor(
      jsonRequest("/api/models", { cookie: userCookie }).headers,
    ),
    userCookie,
  };
}

describe("resolveAvailableModels", () => {
  beforeEach(async () => {
    await resetState();
  });

  afterAll(async () => {
    await resetState();
  });

  it("returns own and shared models with provenance and excludes others' private configs", async () => {
    const { superActor, userActor, userCookie } = await seedActors();

    const own = await createProviderConfig(
      {
        name: "mine",
        apiFormat: "openai-compatible",
        baseUrl: "https://mine.example.com/v1",
        visibility: "private",
      },
      userActor,
    );
    await addProviderModel(own.id, { modelId: "mine-model" }, userActor);

    const secondOwn = await createProviderConfig(
      {
        name: "mine-two",
        apiFormat: "openai-compatible",
        baseUrl: "https://mine.example.com/v1",
        visibility: "private",
      },
      userActor,
    );
    await addProviderModel(secondOwn.id, { modelId: "also-mine" }, userActor);

    const shared = await createProviderConfig(
      {
        name: "instance",
        apiFormat: "openai-compatible",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-admin",
        visibility: "shared",
      },
      superActor,
    );
    await addProviderModel(shared.id, { modelId: "gpt-4o" }, superActor);

    const hidden = await createProviderConfig(
      {
        name: "admin-private",
        apiFormat: "openai-compatible",
        baseUrl: "https://hidden.example.com/v1",
        apiKey: "sk-hidden",
        visibility: "private",
      },
      superActor,
    );
    await addProviderModel(hidden.id, { modelId: "secret-model" }, superActor);

    const resolved = await resolveAvailableModels(userActor);
    const modelIds = resolved.map((entry) => entry.modelId).sort();
    expect(modelIds).toEqual(["also-mine", "gpt-4o", "mine-model"]);

    const ownEntry = resolved.find((entry) => entry.modelId === "mine-model");
    expect(ownEntry).toMatchObject({
      configId: own.id,
      configName: "mine",
      provenance: "own",
      ownerName: null,
    });

    const sharedEntry = resolved.find((entry) => entry.modelId === "gpt-4o");
    expect(sharedEntry).toMatchObject({
      configId: shared.id,
      configName: "instance",
      provenance: "shared",
      ownerName: adminCredentials.username,
    });

    expect(resolved.some((entry) => entry.modelId === "secret-model")).toBe(
      false,
    );

    const viaRoute = await getModels(
      jsonRequest("/api/models", { cookie: userCookie }),
    );
    expect(viaRoute.status).toBe(200);
    const body = await readJson(viaRoute);
    expect(Array.isArray(body)).toBe(true);

    await deleteProviderConfig(own.id, userActor);
    const afterDelete = await resolveAvailableModels(userActor);
    expect(afterDelete.map((entry) => entry.modelId).sort()).toEqual([
      "also-mine",
      "gpt-4o",
    ]);
  });
});
