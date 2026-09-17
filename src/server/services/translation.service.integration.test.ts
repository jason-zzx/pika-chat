import "server-only";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { createChatModelHandle, generateText } = vi.hoisted(() => ({
  createChatModelHandle: vi.fn(),
  generateText: vi.fn(),
}));

// The model handle is mocked: ownership and persistence run against the real
// database; only the provider call itself is stubbed (no real credentials).
vi.mock("@/server/ai/chat-model", () => ({ createChatModelHandle }));
vi.mock("ai", () => ({ generateText }));

import { requireActor } from "@/server/auth/actor";
import {
  adminCredentials,
  authPost,
  cookiesFrom,
  jsonRequest,
  otherAdminCredentials,
  postSetup,
  userCredentials,
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
import { createAssistant } from "@/server/services/assistant.service";
import {
  appendAssistantMessage,
  appendUserMessage,
  listTopicMessages,
} from "@/server/services/message.service";
import { createTopicForChat } from "@/server/services/topic.service";

import {
  buildTranslateInstructions,
  translateMessage,
} from "./translation.service";

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

async function signIn(email: string, password: string): Promise<string> {
  const response = await authPost(
    jsonRequest("/api/auth/sign-in/email", { body: { email, password } }),
  );
  expect(response.status).toBe(200);
  return cookiesFrom(response);
}

async function seedActors() {
  const setup = await postSetup(
    jsonRequest("/api/setup", { body: adminCredentials }),
  );
  expect(setup.status).toBe(201);
  const superCookie = cookiesFrom(setup);

  for (const credentials of [userCredentials, otherAdminCredentials]) {
    const created = await authPost(
      jsonRequest("/api/auth/admin/create-user", {
        cookie: superCookie,
        body: {
          email: credentials.email,
          password: credentials.password,
          name: credentials.username,
          role: "user",
          data: { username: credentials.username },
        },
      }),
    );
    expect(created.status).toBe(200);
  }

  const cookie = await signIn(userCredentials.email, userCredentials.password);
  const otherCookie = await signIn(
    otherAdminCredentials.email,
    otherAdminCredentials.password,
  );
  return {
    actor: await requireActor(jsonRequest("/api/topics", { cookie }).headers),
    otherActor: await requireActor(
      jsonRequest("/api/topics", { cookie: otherCookie }).headers,
    ),
  };
}

type Actor = Awaited<ReturnType<typeof seedActors>>["actor"];

async function setupTopicWithMessage(): Promise<{
  actor: Actor;
  otherActor: Actor;
  topicId: string;
}> {
  const { actor, otherActor } = await seedActors();
  const assistant = await createAssistant({ name: "Owner", icon: "✨" }, actor);
  const topic = await createTopicForChat(
    { assistantId: assistant.id },
    actor,
    "New topic",
  );
  await db.insert(providerConfigs).values({
    id: "cfg-1",
    ownerId: actor.userId,
    name: "Test",
    baseUrl: "http://localhost:11434/v1",
  });
  await appendUserMessage(
    {
      topicId: topic.id,
      message: {
        id: "m1",
        role: "user",
        parts: [{ type: "text", text: "Bonjour le monde" }],
      },
    },
    actor,
  );
  await appendAssistantMessage(
    {
      topicId: topic.id,
      message: {
        id: "m2",
        role: "assistant",
        parts: [{ type: "text", text: "Hello **world**" }],
      },
      outcome: "completed",
      providerConfigId: "cfg-1",
      modelId: "gpt-4o",
    },
    actor,
  );
  return { actor, otherActor, topicId: topic.id };
}

const INPUT = {
  providerConfigId: "cfg-1",
  modelId: "gpt-4o",
};

describe("buildTranslateInstructions", () => {
  it("names the target language in its native form", () => {
    const instructions = buildTranslateInstructions("zh-CN");
    expect(instructions).toContain("简体中文");
    expect(instructions).toContain("translation only");
    expect(instructions).toContain("already in 简体中文");
  });
});

describe("translateMessage", () => {
  beforeEach(async () => {
    await resetState();
    vi.clearAllMocks();
    createChatModelHandle.mockResolvedValue({
      model: {},
      describeError: vi.fn(),
    });
    generateText.mockResolvedValue({ text: "你好，世界" });
  });

  afterAll(async () => {
    await resetState();
  });

  it("translates an assistant message and persists it on the row", async () => {
    const { actor, topicId } = await setupTopicWithMessage();

    const result = await translateMessage(
      { messageId: "m2", targetLang: "zh-CN", ...INPUT },
      actor,
    );

    expect(result).toEqual({ translation: "你好，世界" });
    expect(generateText).toHaveBeenCalledTimes(1);
    const call = generateText.mock.calls[0]?.[0] as {
      instructions: string;
      prompt: string;
    };
    expect(call.instructions).toContain("简体中文");
    expect(call.prompt).toBe("Hello **world**");

    const rows = await db
      .select({ translations: chatMessages.translations })
      .from(chatMessages)
      .where(eq(chatMessages.id, "m2"));
    expect(rows[0]?.translations).toEqual({ "zh-CN": "你好，世界" });

    // The history read model exposes the translation in metadata (R4).
    const messages = await listTopicMessages({ topicId }, actor);
    expect(
      messages.find((message) => message.id === "m2")?.metadata?.translations,
    ).toEqual({ "zh-CN": "你好，世界" });
  });

  it("translates a user message", async () => {
    const { actor } = await setupTopicWithMessage();
    generateText.mockResolvedValue({ text: "Hello world" });

    const result = await translateMessage(
      { messageId: "m1", targetLang: "en", ...INPUT },
      actor,
    );

    expect(result).toEqual({ translation: "Hello world" });
    const call = generateText.mock.calls[0]?.[0] as { prompt: string };
    expect(call.prompt).toBe("Bonjour le monde");
  });

  it("returns a cached translation without calling the model again", async () => {
    const { actor } = await setupTopicWithMessage();
    await translateMessage({ messageId: "m2", targetLang: "en", ...INPUT }, actor);
    expect(generateText).toHaveBeenCalledTimes(1);

    const again = await translateMessage(
      { messageId: "m2", targetLang: "en", ...INPUT },
      actor,
    );

    expect(again).toEqual({ translation: "你好，世界" });
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it("merges languages without overwriting existing translations", async () => {
    const { actor } = await setupTopicWithMessage();
    generateText.mockResolvedValueOnce({ text: "Hello **world**" });
    await translateMessage({ messageId: "m2", targetLang: "en", ...INPUT }, actor);
    generateText.mockResolvedValueOnce({ text: "Bonjour **le monde**" });
    await translateMessage({ messageId: "m2", targetLang: "fr", ...INPUT }, actor);

    const rows = await db
      .select({ translations: chatMessages.translations })
      .from(chatMessages)
      .where(eq(chatMessages.id, "m2"));
    expect(rows[0]?.translations).toEqual({
      en: "Hello **world**",
      fr: "Bonjour **le monde**",
    });
  });

  it("keeps translations per version: a sibling version row is untouched", async () => {
    const { actor, topicId } = await setupTopicWithMessage();
    await appendAssistantMessage(
      {
        topicId,
        message: {
          id: "m3",
          role: "assistant",
          parts: [{ type: "text", text: "Replacement answer" }],
        },
        outcome: "completed",
        providerConfigId: "cfg-1",
        modelId: "gpt-4o",
        groupId: "m2",
      },
      actor,
    );

    await translateMessage({ messageId: "m3", targetLang: "de", ...INPUT }, actor);

    const rows = await db
      .select({ id: chatMessages.id, translations: chatMessages.translations })
      .from(chatMessages);
    const byId = new Map(rows.map((row) => [row.id, row.translations]));
    expect(byId.get("m3")).toEqual({ de: "你好，世界" });
    expect(byId.get("m2")).toBeNull();
  });

  it("rejects foreign and unknown messages as NOT_FOUND", async () => {
    const { actor, otherActor } = await setupTopicWithMessage();

    await expect(
      translateMessage({ messageId: "m2", targetLang: "en", ...INPUT }, otherActor),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      translateMessage({ messageId: "nope", targetLang: "en", ...INPUT }, actor),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(generateText).not.toHaveBeenCalled();
  });

  it("rejects a message without translatable text", async () => {
    const { actor, topicId } = await setupTopicWithMessage();
    await appendUserMessage(
      {
        topicId,
        message: {
          id: "m4",
          role: "user",
          parts: [
            {
              type: "file",
              url: "/api/files/f1",
              mediaType: "image/png",
              filename: "a.png",
            },
          ],
        },
      },
      actor,
    );

    await expect(
      translateMessage({ messageId: "m4", targetLang: "en", ...INPUT }, actor),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: "translation.emptyText",
    });
  });

  it("maps provider failures through the handle's describeError", async () => {
    const { actor } = await setupTopicWithMessage();
    createChatModelHandle.mockResolvedValue({
      model: {},
      describeError: vi.fn(() => ({
        code: "PROVIDER_ERROR",
        kind: "key",
        messageKey: "provider.unreachable",
      })),
    });
    generateText.mockRejectedValue(new Error("connection refused"));

    await expect(
      translateMessage({ messageId: "m2", targetLang: "en", ...INPUT }, actor),
    ).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      status: 502,
      message: "provider.unreachable",
    });

    // Nothing is persisted on failure.
    const rows = await db
      .select({ translations: chatMessages.translations })
      .from(chatMessages)
      .where(eq(chatMessages.id, "m2"));
    expect(rows[0]?.translations).toBeNull();
  });

  it("rejects an empty model response as an unexpected provider response", async () => {
    const { actor } = await setupTopicWithMessage();
    generateText.mockResolvedValue({ text: "   " });

    await expect(
      translateMessage({ messageId: "m2", targetLang: "en", ...INPUT }, actor),
    ).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      message: "provider.unexpectedResponse",
    });
  });
});
