import "server-only";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_ASSISTANT_ICON } from "@/lib/schemas/assistant";
import { requireActor } from "@/server/auth/actor";
import {
  adminCredentials,
  jsonRequest,
  otherAdminCredentials,
  postSetup,
  userCredentials,
  cookiesFrom,
  authPost,
} from "@/server/auth/auth-test-helpers";
import { getDb } from "@/server/db/client";
import {
  APP_SETTINGS_ROW_ID,
  accounts,
  appSettings,
  assistants,
  chatMessages,
  providerConfigs,
  providerModels,
  sessions,
  topics,
  users,
  verifications,
} from "@/server/db/schema";
import {
  createAssistant,
  deleteAssistant,
  listAssistantTree,
  updateAssistant,
} from "@/server/services/assistant.service";
import { appendUserMessage } from "@/server/services/message.service";
import { createTopicForChat, setTopicFavorite, touchTopicUpdatedAt } from "@/server/services/topic.service";
import {
  addProviderModel,
  createProviderConfig,
} from "@/server/services/provider.service";
import { AppError } from "@/server/errors";

/** The route boundary resolves the real `Assistant.defaultName`; the service
 * stores whatever localized default it is handed. */
const DEFAULT_NAME = "Assistant";
const DEFAULT_TITLE = "New topic";

const db = getDb();

async function resetState(): Promise<void> {
  await db.delete(chatMessages);
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
    otherAdminActor: await actorFromCookie(otherAdminCookie),
  };
}

describe("assistant.service", () => {
  beforeEach(async () => {
    await resetState();
  });

  afterAll(async () => {
    await resetState();
  });

  it("lets the owner create, list, update, and delete, and 404s for another user", async () => {
    const { userActor, otherAdminActor } = await seedActors();
    const created = await createAssistant(
      { name: "Work", icon: "💼", systemPrompt: "Be brief" },
      userActor,
    );
    expect(created.name).toBe("Work");
    expect(created.icon).toBe("💼");
    expect(created.systemPrompt).toBe("Be brief");
    expect(created.topics).toEqual([]);

    const listed = await listAssistantTree(userActor, DEFAULT_NAME);
    expect(listed.assistants.map((row) => row.id)).toContain(created.id);

    const updated = await updateAssistant(
      created.id,
      { name: "Lab", systemPrompt: null },
      userActor,
    );
    expect(updated.name).toBe("Lab");
    expect(updated.systemPrompt).toBeNull();

    await expect(
      updateAssistant(created.id, { name: "Hijack" }, otherAdminActor),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      deleteAssistant(created.id, otherAdminActor),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const second = await createAssistant(
      { name: "Spare", icon: "📁" },
      userActor,
    );
    await deleteAssistant(created.id, userActor);
    const after = await listAssistantTree(userActor, DEFAULT_NAME);
    expect(after.assistants.map((row) => row.id)).toEqual([second.id]);
  });

  it("seeds exactly one assistant on the first empty list and does not duplicate", async () => {
    const { userActor } = await seedActors();
    const first = await listAssistantTree(userActor, DEFAULT_NAME);
    expect(first.assistants).toHaveLength(1);
    const seeded = first.assistants[0];
    expect(seeded?.name).toBe(DEFAULT_NAME);
    expect(seeded?.icon).toBe(DEFAULT_ASSISTANT_ICON);
    expect(seeded?.systemPrompt).toBeNull();
    expect(seeded?.defaultProviderConfigId).toBeNull();
    expect(seeded?.defaultModelId).toBeNull();

    const second = await listAssistantTree(userActor, DEFAULT_NAME);
    expect(second.assistants).toHaveLength(1);
    expect(second.assistants[0]?.id).toBe(seeded?.id);

    const rows = await db
      .select({ id: assistants.id })
      .from(assistants)
      .where(eq(assistants.ownerId, userActor.userId));
    expect(rows).toHaveLength(1);
  });

  it("converges concurrent first-list calls onto one seeded row", async () => {
    const { userActor } = await seedActors();
    const [left, right] = await Promise.all([
      listAssistantTree(userActor, DEFAULT_NAME),
      listAssistantTree(userActor, DEFAULT_NAME),
    ]);
    expect(left.assistants).toHaveLength(1);
    expect(right.assistants).toHaveLength(1);
    expect(left.assistants[0]?.id).toBe(right.assistants[0]?.id);

    const rows = await db
      .select({ id: assistants.id })
      .from(assistants)
      .where(eq(assistants.ownerId, userActor.userId));
    expect(rows).toHaveLength(1);
  });

  it("returns 409 when creating a second assistant with an existing name", async () => {
    const { userActor } = await seedActors();
    await createAssistant({ name: "Dup", icon: "✨" }, userActor);
    await expect(
      createAssistant({ name: "Dup", icon: "📁" }, userActor),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("saves with no default model and with a resolved available model", async () => {
    const { userActor } = await seedActors();
    const bare = await createAssistant(
      { name: "Bare", icon: "✨" },
      userActor,
    );
    expect(bare.defaultProviderConfigId).toBeNull();
    expect(bare.defaultModelId).toBeNull();

    const config = await createProviderConfig(
      {
        name: "byok",
        apiFormat: "openai-compatible",
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-test",
        visibility: "private",
      },
      userActor,
    );
    await addProviderModel(config.id, { modelId: "gpt-4o" }, userActor);

    const withModel = await createAssistant(
      {
        name: "Pinned",
        icon: "🤖",
        defaultProviderConfigId: config.id,
        defaultModelId: "gpt-4o",
      },
      userActor,
    );
    expect(withModel.defaultProviderConfigId).toBe(config.id);
    expect(withModel.defaultModelId).toBe("gpt-4o");

    const cleared = await updateAssistant(
      withModel.id,
      { defaultProviderConfigId: null, defaultModelId: null },
      userActor,
    );
    expect(cleared.defaultProviderConfigId).toBeNull();
    expect(cleared.defaultModelId).toBeNull();
  });

  it("rejects a default model that is not in the available set", async () => {
    const { userActor } = await seedActors();
    await expect(
      createAssistant(
        {
          name: "Bad pin",
          icon: "🤖",
          defaultProviderConfigId: "missing",
          defaultModelId: "nope",
        },
        userActor,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
  });

  it("deletes an assistant's topics when the assistant is deleted", async () => {
    const { userActor } = await seedActors();
    const primary = await createAssistant(
      { name: "Primary", icon: "1️⃣" },
      userActor,
    );
    const extra = await createAssistant(
      { name: "Extra", icon: "2️⃣" },
      userActor,
    );
    const topic = await createTopicForChat(
      { assistantId: extra.id },
      userActor,
      DEFAULT_TITLE,
    );
    await appendUserMessage(
      {
        topicId: topic.id,
        message: {
          id: "msg-cascade",
          role: "user",
          parts: [{ type: "text", text: "cascade" }],
        },
      },
      userActor,
    );
    await deleteAssistant(extra.id, userActor);

    const leftover = await db
      .select({ id: topics.id })
      .from(topics)
      .where(eq(topics.id, topic.id));
    expect(leftover).toEqual([]);
    const leftoverMessages = await db
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(eq(chatMessages.topicId, topic.id));
    expect(leftoverMessages).toEqual([]);
    const tree = await listAssistantTree(userActor, DEFAULT_NAME);
    expect(tree.assistants.map((row) => row.id)).toEqual([primary.id]);
  });

  it("refuses to delete the last assistant and leaves its topics intact", async () => {
    const { userActor } = await seedActors();
    const only = await createAssistant(
      { name: "Only", icon: "🔒" },
      userActor,
    );
    const topic = await createTopicForChat(
      { assistantId: only.id },
      userActor,
      DEFAULT_TITLE,
    );

    await expect(deleteAssistant(only.id, userActor)).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    });

    const still = await listAssistantTree(userActor, DEFAULT_NAME);
    expect(still.assistants).toHaveLength(1);
    expect(still.assistants[0]?.topics.map((row) => row.id)).toEqual([
      topic.id,
    ]);

    const second = await createAssistant(
      { name: "Second", icon: "📁" },
      userActor,
    );
    await deleteAssistant(only.id, userActor);
    await expect(deleteAssistant(second.id, userActor)).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    });
  });

  it("leaves at least one assistant when two concurrent deletes race", async () => {
    const { userActor } = await seedActors();
    const first = await createAssistant(
      { name: "Alpha", icon: "🅰️" },
      userActor,
    );
    const second = await createAssistant(
      { name: "Beta", icon: "🅱️" },
      userActor,
    );

    const results = await Promise.allSettled([
      deleteAssistant(first.id, userActor),
      deleteAssistant(second.id, userActor),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const failure = rejected[0];
    expect(failure?.status).toBe("rejected");
    if (failure?.status === "rejected") {
      expect(failure.reason).toBeInstanceOf(AppError);
      expect(failure.reason).toMatchObject({ code: "CONFLICT", status: 409 });
    }

    const remaining = await listAssistantTree(userActor, DEFAULT_NAME);
    expect(remaining.assistants).toHaveLength(1);
  });

  it("orders topics by recent activity", async () => {
    const { userActor } = await seedActors();
    const assistant = await createAssistant(
      { name: "Owner", icon: "✨" },
      userActor,
    );
    const older = await createTopicForChat(
      { assistantId: assistant.id },
      userActor,
      DEFAULT_TITLE,
    );
    const newer = await createTopicForChat(
      { assistantId: assistant.id },
      userActor,
      DEFAULT_TITLE,
    );

    await db
      .update(topics)
      .set({ updatedAt: new Date("2026-01-01T00:00:00.000Z") })
      .where(eq(topics.id, older.id));
    await db
      .update(topics)
      .set({ updatedAt: new Date("2026-01-02T00:00:00.000Z") })
      .where(eq(topics.id, newer.id));

    const before = await listAssistantTree(userActor, DEFAULT_NAME);
    const listed = before.assistants.find((row) => row.id === assistant.id);
    expect(listed?.topics.map((topic) => topic.id)).toEqual([
      newer.id,
      older.id,
    ]);

    await touchTopicUpdatedAt(older.id, userActor);
    const after = await listAssistantTree(userActor, DEFAULT_NAME);
    const relisted = after.assistants.find((row) => row.id === assistant.id);
    expect(relisted?.topics.map((topic) => topic.id)).toEqual([
      older.id,
      newer.id,
    ]);
  });

  it("exposes the favorite flag through the tree without reordering", async () => {
    const { userActor } = await seedActors();
    const assistant = await createAssistant(
      { name: "Owner", icon: "✨" },
      userActor,
    );
    const older = await createTopicForChat(
      { assistantId: assistant.id },
      userActor,
      DEFAULT_TITLE,
    );
    const newer = await createTopicForChat(
      { assistantId: assistant.id },
      userActor,
      DEFAULT_TITLE,
    );
    await db
      .update(topics)
      .set({ updatedAt: new Date("2026-01-01T00:00:00.000Z") })
      .where(eq(topics.id, older.id));
    await db
      .update(topics)
      .set({ updatedAt: new Date("2026-01-02T00:00:00.000Z") })
      .where(eq(topics.id, newer.id));

    await setTopicFavorite(older.id, { favorite: true }, userActor);

    const tree = await listAssistantTree(userActor, DEFAULT_NAME);
    const listed = tree.assistants.find((row) => row.id === assistant.id);
    // Favoriting the older topic must not reorder: updatedAt is untouched.
    expect(
      listed?.topics.map((row) => ({ id: row.id, isFavorite: row.isFavorite })),
    ).toEqual([
      { id: newer.id, isFavorite: false },
      { id: older.id, isFavorite: true },
    ]);
  });
});
