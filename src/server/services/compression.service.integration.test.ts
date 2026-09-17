import "server-only";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { generateText } = vi.hoisted(() => ({
  generateText: vi.fn(),
}));

// The provider call is stubbed; ownership, persistence, and the rolling
// boundary all run against the real database.
vi.mock("ai", () => ({ generateText }));

import { POST as compressTopicRoute } from "@/app/api/topics/[id]/compress/route";
import { GET as getTopicRoute } from "@/app/api/topics/[id]/route";
import {
  adminCredentials,
  authPost,
  cookiesFrom,
  jsonRequest,
  otherAdminCredentials,
  postSetup,
  userCredentials,
} from "@/server/auth/auth-test-helpers";
import { requireActor } from "@/server/auth/actor";
import type { Actor } from "@/server/auth/actor";
import type { ChatModelHandle } from "@/server/ai/chat-model";
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
  deleteMessage,
  listTopicMessages,
  resolveRegenerateTarget,
} from "@/server/services/message.service";
import { createTopicForChat } from "@/server/services/topic.service";

import {
  boundaryFromSummaryState,
  compressTopicHistory,
  getTopicSummaryState,
  messagesAfterBoundary,
} from "./compression.service";

const db = getDb();

const HANDLE = {
  model: {},
  describeError: () => ({ kind: "key" as const, messageKey: "generic" }),
  apiFormat: "openai-compatible" as const,
  providerConfigId: "cfg-1",
  filesApi: null,
} as unknown as ChatModelHandle;

const MODEL_INPUT = { providerConfigId: "cfg-1", modelId: "gpt-4o" };

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
    cookie,
    otherCookie,
    actor: await requireActor(jsonRequest("/api/topics", { cookie }).headers),
    otherActor: await requireActor(
      jsonRequest("/api/topics", { cookie: otherCookie }).headers,
    ),
  };
}

function routeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function setupTopic(actor: Actor, messageCount = 4) {
  const assistant = await createAssistant({ name: "Owner", icon: "✨" }, actor);
  const topic = await createTopicForChat(
    { assistantId: assistant.id },
    actor,
    "New topic",
  );
  // Provider config + model row so the route's availability gate passes.
  await db.insert(providerConfigs).values({
    id: "cfg-1",
    ownerId: actor.userId,
    name: "Test",
    baseUrl: "http://localhost:11434/v1",
  });
  await db.insert(providerModels).values({
    id: "pm-1",
    providerConfigId: "cfg-1",
    modelId: "gpt-4o",
  });
  for (let index = 1; index <= messageCount; index += 1) {
    const id = `m${index}`;
    if (index % 2 === 1) {
      await appendUserMessage(
        {
          topicId: topic.id,
          message: {
            id,
            role: "user",
            parts: [{ type: "text", text: `question ${index}` }],
          },
        },
        actor,
      );
    } else {
      await appendAssistantMessage(
        {
          topicId: topic.id,
          message: {
            id,
            role: "assistant",
            parts: [{ type: "text", text: `answer ${index}` }],
          },
          outcome: "completed",
          providerConfigId: "cfg-1",
          modelId: "gpt-4o",
        },
        actor,
      );
    }
  }
  return topic.id;
}

describe("compressTopicHistory", () => {
  beforeEach(async () => {
    await resetState();
    vi.clearAllMocks();
    generateText.mockResolvedValue({ text: "rolling summary" });
  });

  afterAll(async () => {
    await resetState();
  });

  it("persists the summary and boundary without touching the messages", async () => {
    const { actor } = await seedActors();
    const topicId = await setupTopic(actor);

    const result = await compressTopicHistory({ topicId, handle: HANDLE }, actor);

    expect(result).toEqual({
      summaryText: "rolling summary",
      summaryUpToMessageId: "m4",
      summaryUpToGroupId: "m4",
      compressedCount: 4,
    });
    const prompt = generateText.mock.calls[0]?.[0] as { prompt: string };
    expect(prompt.prompt).toContain("User: question 1");
    expect(prompt.prompt).toContain("Assistant: answer 4");
    expect(prompt.prompt).not.toContain("previous-summary");

    const state = await getTopicSummaryState(topicId, actor);
    expect(state?.summaryText).toBe("rolling summary");
    expect(state?.summaryUpToMessageId).toBe("m4");
    expect(state?.summaryUpToGroupId).toBe("m4");

    // AC5: the persisted messages are byte-identical after compression.
    const messages = await listTopicMessages({ topicId }, actor);
    expect(messages.map((message) => message.id)).toEqual([
      "m1",
      "m2",
      "m3",
      "m4",
    ]);
  });

  it("rolls the summary forward and only folds in new messages", async () => {
    const { actor } = await seedActors();
    const topicId = await setupTopic(actor);
    await compressTopicHistory({ topicId, handle: HANDLE }, actor);

    await appendUserMessage(
      {
        topicId,
        message: {
          id: "m5",
          role: "user",
          parts: [{ type: "text", text: "question 5" }],
        },
      },
      actor,
    );
    generateText.mockResolvedValueOnce({ text: "updated summary" });

    const result = await compressTopicHistory({ topicId, handle: HANDLE }, actor);

    expect(result.summaryUpToMessageId).toBe("m5");
    expect(result.compressedCount).toBe(1);
    const prompt = generateText.mock.calls[1]?.[0] as { prompt: string };
    expect(prompt.prompt).toContain("<previous-summary>\nrolling summary");
    expect(prompt.prompt).toContain("User: question 5");
    expect(prompt.prompt).not.toContain("question 1");

    const state = await getTopicSummaryState(topicId, actor);
    expect(state?.summaryText).toBe("updated summary");
    expect(state?.summaryUpToMessageId).toBe("m5");
  });

  it("clips by version group after the boundary group's selected version is switched", async () => {
    const { actor } = await seedActors();
    const topicId = await setupTopic(actor);
    await compressTopicHistory({ topicId, handle: HANDLE }, actor);

    // New answer version in the boundary group: m4 is deselected, m4b selected.
    await appendAssistantMessage(
      {
        topicId,
        message: {
          id: "m4b",
          role: "assistant",
          parts: [{ type: "text", text: "answer 4 (v2)" }],
        },
        outcome: "completed",
        providerConfigId: "cfg-1",
        modelId: "gpt-4o",
        groupId: "m4",
      },
      actor,
    );

    const state = await getTopicSummaryState(topicId, actor);
    expect(state?.summaryUpToMessageId).toBe("m4");
    expect(state?.summaryUpToGroupId).toBe("m4");

    // The boundary group resolves by group id, so the clip stays empty instead
    // of falling back to the full history (which would duplicate the summary).
    const messages = await listTopicMessages({ topicId }, actor);
    expect(messages.map((message) => message.id)).toEqual([
      "m1",
      "m2",
      "m3",
      "m4b",
    ]);
    expect(
      messagesAfterBoundary(messages, boundaryFromSummaryState(state)),
    ).toEqual([]);

    // The server-side lock tracks the same group, so the switch does not
    // unlock the compressed zone.
    await expect(
      deleteMessage({ topicId, messageId: "m1" }, actor),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      resolveRegenerateTarget({ topicId, messageId: "m4b" }, actor),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects a second compression when nothing new arrived", async () => {
    const { actor } = await seedActors();
    const topicId = await setupTopic(actor);
    await compressTopicHistory({ topicId, handle: HANDLE }, actor);

    await expect(
      compressTopicHistory({ topicId, handle: HANDLE }, actor),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      messageKey: "topic.nothingToCompress",
    });
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty topic", async () => {
    const { actor } = await seedActors();
    const topicId = await setupTopic(actor, 0);

    await expect(
      compressTopicHistory({ topicId, handle: HANDLE }, actor),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(generateText).not.toHaveBeenCalled();
  });

  it("is invisible to another user", async () => {
    const { actor, otherActor } = await seedActors();
    const topicId = await setupTopic(actor);

    await expect(
      compressTopicHistory({ topicId, handle: HANDLE }, otherActor),
    ).rejects.toMatchObject({ code: "NOT_FOUND", messageKey: "topic.notFound" });
    expect(generateText).not.toHaveBeenCalled();
  });

  it("propagates an empty model summary as a provider error", async () => {
    const { actor } = await seedActors();
    const topicId = await setupTopic(actor);
    generateText.mockResolvedValueOnce({ text: "   " });

    await expect(
      compressTopicHistory({ topicId, handle: HANDLE }, actor),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    // Nothing persisted: the topic stays uncompressed.
    expect(await getTopicSummaryState(topicId, actor)).toBeNull();
  });
});

describe("POST /api/topics/[id]/compress", () => {
  beforeEach(async () => {
    await resetState();
    vi.clearAllMocks();
    generateText.mockResolvedValue({ text: "rolling summary" });
  });

  afterAll(async () => {
    await resetState();
  });

  it("compresses on demand and the topic detail exposes the boundary", async () => {
    const { cookie, actor } = await seedActors();
    const topicId = await setupTopic(actor);

    const response = await compressTopicRoute(
      jsonRequest(`/api/topics/${topicId}/compress`, { cookie, body: MODEL_INPUT }),
      routeContext(topicId),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      summaryUpToMessageId: "m4",
      compressedCount: 4,
    });

    const detail = await getTopicRoute(
      jsonRequest(`/api/topics/${topicId}`, { cookie }),
      routeContext(topicId),
    );
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      id: topicId,
      summaryUpToMessageId: "m4",
      summaryUpToGroupId: "m4",
      summaryText: "rolling summary",
    });
  });

  it("exposes a null summary on an uncompressed topic", async () => {
    const { cookie, actor } = await seedActors();
    const topicId = await setupTopic(actor);

    const detail = await getTopicRoute(
      jsonRequest(`/api/topics/${topicId}`, { cookie }),
      routeContext(topicId),
    );

    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      id: topicId,
      summaryUpToMessageId: null,
      summaryUpToGroupId: null,
      summaryText: null,
    });
  });

  it("does not leak another user's topic detail (404, not 403)", async () => {
    const { actor, otherCookie } = await seedActors();
    const topicId = await setupTopic(actor);

    const detail = await getTopicRoute(
      jsonRequest(`/api/topics/${topicId}`, { cookie: otherCookie }),
      routeContext(topicId),
    );

    expect(detail.status).toBe(404);
    await expect(detail.json()).resolves.toMatchObject({
      error: { messageKey: "topic.notFound" },
    });
  });

  it("returns 404 for another user's topic", async () => {
    const { actor, otherActor, otherCookie } = await seedActors();
    const topicId = await setupTopic(actor);
    // The other caller needs a model of their own so the availability gate
    // passes and the topic ownership check is what actually rejects them.
    await db.insert(providerConfigs).values({
      id: "cfg-other",
      ownerId: otherActor.userId,
      name: "Other",
      baseUrl: "http://localhost:11434/v1",
    });
    await db.insert(providerModels).values({
      id: "pm-other",
      providerConfigId: "cfg-other",
      modelId: "gpt-4o",
    });

    const response = await compressTopicRoute(
      jsonRequest(`/api/topics/${topicId}/compress`, {
        cookie: otherCookie,
        body: { providerConfigId: "cfg-other", modelId: "gpt-4o" },
      }),
      routeContext(topicId),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { messageKey: "topic.notFound" },
    });
    expect(generateText).not.toHaveBeenCalled();
  });

  it("returns 400 when there is nothing to compress", async () => {
    const { cookie, actor } = await seedActors();
    const topicId = await setupTopic(actor, 0);

    const response = await compressTopicRoute(
      jsonRequest(`/api/topics/${topicId}/compress`, { cookie, body: MODEL_INPUT }),
      routeContext(topicId),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { messageKey: "topic.nothingToCompress" },
    });
  });

  it("rejects a model the caller cannot use", async () => {
    const { cookie, actor } = await seedActors();
    const topicId = await setupTopic(actor);

    const response = await compressTopicRoute(
      jsonRequest(`/api/topics/${topicId}/compress`, {
        cookie,
        body: { providerConfigId: "cfg-1", modelId: "unknown-model" },
      }),
      routeContext(topicId),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { messageKey: "model.notAvailable" },
    });
  });
});
