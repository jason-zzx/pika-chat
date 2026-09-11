import "server-only";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { requireActor } from "@/server/auth/actor";
import {
  adminCredentials,
  authPost,
  cookiesFrom,
  jsonRequest,
  postSetup,
  userCredentials,
} from "@/server/auth/auth-test-helpers";
import { getDb } from "@/server/db/client";
import {
  APP_SETTINGS_ROW_ID,
  accounts,
  appSettings,
  assistants,
  providerConfigs,
  providerModels,
  sessions,
  topics,
  users,
  verifications,
} from "@/server/db/schema";
import {
  createAssistant,
  listAssistantTree,
  updateAssistant,
} from "@/server/services/assistant.service";
import {
  addProviderModel,
  createProviderConfig,
  deleteProviderConfig,
} from "@/server/services/provider.service";

const db = getDb();

async function resetState(): Promise<void> {
  await db.delete(topics);
  await db.delete(assistants);
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
  return requireActor(jsonRequest("/api/assistants", { cookie }).headers);
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
  const userCookie = await signIn(
    userCredentials.email,
    userCredentials.password,
  );
  return { userActor: await actorFromCookie(userCookie) };
}

describe("assistant default model reference", () => {
  beforeEach(async () => {
    await resetState();
  });

  afterAll(async () => {
    await resetState();
  });

  it("nulls the provider config id when the backing config is deleted and still loads", async () => {
    const { userActor } = await seedActors();
    const config = await createProviderConfig(
      {
        name: "ephemeral",
        apiFormat: "openai-compatible",
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-temp",
        visibility: "private",
      },
      userActor,
    );
    await addProviderModel(config.id, { modelId: "gpt-4o" }, userActor);

    const assistant = await createAssistant(
      {
        name: "Pinned",
        icon: "🤖",
        defaultProviderConfigId: config.id,
        defaultModelId: "gpt-4o",
      },
      userActor,
    );
    expect(assistant.defaultProviderConfigId).toBe(config.id);

    await deleteProviderConfig(config.id, userActor);

    const tree = await listAssistantTree(userActor, "Assistant");
    const loaded = tree.assistants.find((row) => row.id === assistant.id);
    expect(loaded).toBeDefined();
    expect(loaded?.defaultProviderConfigId).toBeNull();
    expect(loaded?.name).toBe("Pinned");

    const saved = await updateAssistant(
      assistant.id,
      { name: "Still here" },
      userActor,
    );
    expect(saved.name).toBe("Still here");
    expect(saved.defaultProviderConfigId).toBeNull();
  });
});
