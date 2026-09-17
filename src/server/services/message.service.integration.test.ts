import "server-only";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

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
  deleteMessage,
  listTopicMessages,
  resolveRegenerateTarget,
  selectMessageVersion,
} from "@/server/services/message.service";
import { createTopicForChat } from "@/server/services/topic.service";

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

function userMessage(id: string, text: string) {
  return { id, role: "user" as const, parts: [{ type: "text" as const, text }] };
}

function assistantMessage(id: string, text: string) {
  return {
    id,
    role: "assistant" as const,
    parts: [{ type: "text" as const, text }],
  };
}

// Ids sort in insertion order ("m1" < "m2" < ...), so the (createdAt, id)
// tiebreak preserves insertion order even when timestamps tie.

async function appendAssistant(
  topicId: string,
  actor: Actor,
  input: { id: string; text: string; groupId?: string },
) {
  return appendAssistantMessage(
    {
      topicId,
      message: assistantMessage(input.id, input.text),
      outcome: "completed",
      providerConfigId: "cfg-1",
      modelId: "gpt-4o",
      ...(input.groupId ? { groupId: input.groupId } : {}),
    },
    actor,
  );
}

async function setupTopic(): Promise<{
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
  // chat_messages.provider_config_id is a real FK: seed a config row.
  await db.insert(providerConfigs).values({
    id: "cfg-1",
    ownerId: actor.userId,
    name: "Test",
    baseUrl: "http://localhost:11434/v1",
  });
  return { actor, otherActor, topicId: topic.id };
}

/** One user + one single-version assistant exchange. */
async function seedTurn(
  topicId: string,
  actor: Actor,
  ids: { user: string; assistant: string },
): Promise<void> {
  await appendUserMessage(
    { topicId, message: userMessage(ids.user, `question ${ids.user}`) },
    actor,
  );
  await appendAssistant(topicId, actor, {
    id: ids.assistant,
    text: `answer ${ids.assistant}`,
  });
}

/** Persists the rolling-compression state directly; the lock reads it from
 * `topics` exactly as the compression service writes it. */
async function setCompressionBoundary(
  topicId: string,
  boundaryMessageId: string,
): Promise<void> {
  await db
    .update(topics)
    .set({
      summaryText: "rolling summary",
      summaryUpToMessageId: boundaryMessageId,
    })
    .where(eq(topics.id, topicId));
}

async function storedMessageIds(topicId: string): Promise<string[]> {
  const rows = await db
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(eq(chatMessages.topicId, topicId));
  return rows.map((row) => row.id).sort();
}

describe("message.service versions", () => {
  beforeEach(async () => {
    await resetState();
  });

  afterAll(async () => {
    await resetState();
  });

  it("lists single-version groups exactly like the flat history", async () => {
    const { actor, topicId } = await setupTopic();
    await seedTurn(topicId, actor, { user: "m1", assistant: "m2" });
    await seedTurn(topicId, actor, { user: "m3", assistant: "m4" });

    const messages = await listTopicMessages({ topicId }, actor);

    expect(messages.map((message) => message.id)).toEqual([
      "m1",
      "m2",
      "m3",
      "m4",
    ]);
    expect(messages[1]?.metadata).toMatchObject({
      groupId: "m2",
      versionIndex: 1,
      versionCount: 1,
      versionIds: ["m2"],
    });
    // User rows never carry version metadata.
    expect(messages[0]?.metadata?.groupId).toBeUndefined();
  });

  it("appends a selected version and exposes group metadata", async () => {
    const { actor, topicId } = await setupTopic();
    await appendUserMessage({ topicId, message: userMessage("m1", "q") }, actor);
    await appendAssistant(topicId, actor, {
      id: "m2",
      text: "first",
    });
    await appendAssistant(topicId, actor, {
      id: "m3",
      text: "second",
      groupId: "m2",
    });

    const messages = await listTopicMessages({ topicId }, actor);

    expect(messages.map((message) => message.id)).toEqual(["m1", "m3"]);
    expect(messages[1]?.metadata).toMatchObject({
      groupId: "m2",
      versionIndex: 2,
      versionCount: 2,
      versionIds: ["m2", "m3"],
    });
    expect(messages[1]?.parts).toEqual([{ type: "text", text: "second" }]);
  });

  it("reselects the newest remaining version after deleting the selected one", async () => {
    const { actor, topicId } = await setupTopic();
    await appendUserMessage({ topicId, message: userMessage("m1", "q") }, actor);
    await appendAssistant(topicId, actor, { id: "m2", text: "first" });
    await appendAssistant(topicId, actor, {
      id: "m3",
      text: "second",
      groupId: "m2",
    });
    await appendAssistant(topicId, actor, {
      id: "m4",
      text: "third",
      groupId: "m2",
    });

    // Select the middle version, then delete it: the newest remaining (m4)
    // takes over.
    await selectMessageVersion({ topicId, messageId: "m3" }, actor);
    const result = await deleteMessage({ topicId, messageId: "m3" }, actor);
    expect(result).toEqual({ deleted: true, groupEmpty: false });

    const messages = await listTopicMessages({ topicId }, actor);
    expect(messages.map((message) => message.id)).toEqual(["m1", "m4"]);
    expect(messages[1]?.metadata).toMatchObject({
      versionIndex: 2,
      versionCount: 2,
      versionIds: ["m2", "m4"],
    });
  });

  it("reports an empty group after deleting the only version", async () => {
    const { actor, topicId } = await setupTopic();
    await seedTurn(topicId, actor, { user: "m1", assistant: "m2" });

    const result = await deleteMessage({ topicId, messageId: "m2" }, actor);
    expect(result).toEqual({ deleted: true, groupEmpty: true });

    const messages = await listTopicMessages({ topicId }, actor);
    expect(messages.map((message) => message.id)).toEqual(["m1"]);
  });

  it("selects an older version and persists the choice", async () => {
    const { actor, topicId } = await setupTopic();
    await appendUserMessage({ topicId, message: userMessage("m1", "q") }, actor);
    await appendAssistant(topicId, actor, { id: "m2", text: "first" });
    await appendAssistant(topicId, actor, {
      id: "m3",
      text: "second",
      groupId: "m2",
    });

    await selectMessageVersion({ topicId, messageId: "m2" }, actor);

    const messages = await listTopicMessages({ topicId }, actor);
    expect(messages.map((message) => message.id)).toEqual(["m1", "m2"]);
    expect(messages[1]?.metadata).toMatchObject({
      versionIndex: 1,
      versionCount: 2,
    });

    const selectedRows = await db
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(eq(chatMessages.isSelected, true));
    expect(selectedRows.map((row) => row.id).sort()).toEqual(["m1", "m2"]);
  });

  it("returns NOT_FOUND for foreign or unknown messages", async () => {
    const { actor, otherActor, topicId } = await setupTopic();
    await seedTurn(topicId, actor, { user: "m1", assistant: "m2" });

    await expect(
      deleteMessage({ topicId, messageId: "m2" }, otherActor),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      selectMessageVersion({ topicId, messageId: "m2" }, otherActor),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      deleteMessage({ topicId, messageId: "nope" }, actor),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      resolveRegenerateTarget({ topicId, messageId: "nope" }, actor),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("resolves an assistant message in the middle to its own group", async () => {
    const { actor, topicId } = await setupTopic();
    await seedTurn(topicId, actor, { user: "m1", assistant: "m2" });
    await seedTurn(topicId, actor, { user: "m3", assistant: "m4" });

    const target = await resolveRegenerateTarget(
      { topicId, messageId: "m2" },
      actor,
    );

    expect(target.targetGroupId).toBe("m2");
    expect(target.history.map((message) => message.id)).toEqual(["m1"]);
  });

  it("resolves a user message with an answer to the following group", async () => {
    const { actor, topicId } = await setupTopic();
    await seedTurn(topicId, actor, { user: "m1", assistant: "m2" });
    await seedTurn(topicId, actor, { user: "m3", assistant: "m4" });

    const target = await resolveRegenerateTarget(
      { topicId, messageId: "m1" },
      actor,
    );

    expect(target.targetGroupId).toBe("m2");
    expect(target.history.map((message) => message.id)).toEqual(["m1"]);
  });

  it("resolves a user message without an answer to a new answer slot", async () => {
    const { actor, topicId } = await setupTopic();
    await seedTurn(topicId, actor, { user: "m1", assistant: "m2" });
    await appendUserMessage({ topicId, message: userMessage("m3", "q2") }, actor);

    const target = await resolveRegenerateTarget(
      { topicId, messageId: "m3" },
      actor,
    );

    expect(target.targetGroupId).toBeNull();
    expect(target.history.map((message) => message.id)).toEqual([
      "m1",
      "m2",
      "m3",
    ]);
  });

  it("treats a user message followed by another user message as unanswered", async () => {
    const { actor, topicId } = await setupTopic();
    await appendUserMessage({ topicId, message: userMessage("m1", "q1") }, actor);
    await appendUserMessage({ topicId, message: userMessage("m2", "q2") }, actor);

    const target = await resolveRegenerateTarget(
      { topicId, messageId: "m1" },
      actor,
    );

    expect(target.targetGroupId).toBeNull();
    expect(target.history.map((message) => message.id)).toEqual(["m1"]);
  });

  it("locks delete inside the compressed zone, boundary inclusive", async () => {
    const { actor, topicId } = await setupTopic();
    await seedTurn(topicId, actor, { user: "m1", assistant: "m2" });
    await seedTurn(topicId, actor, { user: "m3", assistant: "m4" });
    await setCompressionBoundary(topicId, "m2");

    // Boundary message itself and everything before it are immutable.
    await expect(
      deleteMessage({ topicId, messageId: "m2" }, actor),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      messageKey: "message.compressedLocked",
    });
    await expect(
      deleteMessage({ topicId, messageId: "m1" }, actor),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // Nothing was removed.
    expect(await storedMessageIds(topicId)).toEqual(["m1", "m2", "m3", "m4"]);
  });

  it("locks every version of the boundary's own group", async () => {
    const { actor, topicId } = await setupTopic();
    await appendUserMessage({ topicId, message: userMessage("m1", "q") }, actor);
    await appendAssistant(topicId, actor, { id: "m2", text: "first" });
    await appendAssistant(topicId, actor, {
      id: "m3",
      text: "second",
      groupId: "m2",
    });
    // Boundary points at the selected row; the sibling version is covered too.
    await setCompressionBoundary(topicId, "m3");

    await expect(
      deleteMessage({ topicId, messageId: "m2" }, actor),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      resolveRegenerateTarget({ topicId, messageId: "m2" }, actor),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await storedMessageIds(topicId)).toEqual(["m1", "m2", "m3"]);
  });

  it("locks regenerate inside the compressed zone", async () => {
    const { actor, topicId } = await setupTopic();
    await seedTurn(topicId, actor, { user: "m1", assistant: "m2" });
    await seedTurn(topicId, actor, { user: "m3", assistant: "m4" });
    await setCompressionBoundary(topicId, "m2");

    await expect(
      resolveRegenerateTarget({ topicId, messageId: "m1" }, actor),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      messageKey: "message.compressedLocked",
    });
    await expect(
      resolveRegenerateTarget({ topicId, messageId: "m2" }, actor),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("leaves messages after the boundary fully mutable", async () => {
    const { actor, topicId } = await setupTopic();
    await seedTurn(topicId, actor, { user: "m1", assistant: "m2" });
    await seedTurn(topicId, actor, { user: "m3", assistant: "m4" });
    await setCompressionBoundary(topicId, "m2");

    const target = await resolveRegenerateTarget(
      { topicId, messageId: "m3" },
      actor,
    );
    expect(target.targetGroupId).toBe("m4");

    await expect(
      deleteMessage({ topicId, messageId: "m4" }, actor),
    ).resolves.toEqual({ deleted: true, groupEmpty: true });
    expect(await storedMessageIds(topicId)).toEqual(["m1", "m2", "m3"]);
  });

  it("does not lock an uncompressed topic or an unresolvable boundary", async () => {
    const { actor, topicId } = await setupTopic();
    await seedTurn(topicId, actor, { user: "m1", assistant: "m2" });

    // No summary at all: existing behaviour is unchanged.
    await expect(
      deleteMessage({ topicId, messageId: "m2" }, actor),
    ).resolves.toEqual({ deleted: true, groupEmpty: true });

    // A stale boundary id that no longer resolves locks nothing.
    await setCompressionBoundary(topicId, "gone");
    await expect(
      resolveRegenerateTarget({ topicId, messageId: "m1" }, actor),
    ).resolves.toMatchObject({ targetGroupId: null });
  });

  it("builds history from the selected version only", async () => {
    const { actor, topicId } = await setupTopic();
    await seedTurn(topicId, actor, { user: "m1", assistant: "m2" });
    await appendAssistant(topicId, actor, {
      id: "m3",
      text: "replacement",
      groupId: "m2",
    });
    await seedTurn(topicId, actor, { user: "m4", assistant: "m5" });
    await selectMessageVersion({ topicId, messageId: "m2" }, actor);

    const target = await resolveRegenerateTarget(
      { topicId, messageId: "m5" },
      actor,
    );

    expect(target.history.map((message) => message.id)).toEqual([
      "m1",
      "m2",
      "m4",
    ]);
  });
});
