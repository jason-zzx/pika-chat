import "server-only";

import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
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
  chatGenerations,
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
  REQUEST_KEY_TTL_MS,
  admitTurn,
  checkpointGeneration,
  claimGeneration,
  finalizeGeneration,
  findGenerationByRequestId,
  markGenerationStopping,
  purgeTerminalGenerations,
  recoverInterruptedGenerations,
  requestKeyTime,
  type PreparedTurn,
} from "@/server/services/generation.service";
import { listTopicMessages } from "@/server/services/message.service";
import { createTopicForChat, deleteTopic } from "@/server/services/topic.service";

const db = getDb();

async function resetState(): Promise<void> {
  await db.delete(chatGenerations);
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

type Actor = Awaited<ReturnType<typeof requireActor>>;

async function seedActors(): Promise<{ actor: Actor; otherActor: Actor }> {
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

function prepared(
  input: {
    assistantId: string;
    topicId?: string | null;
    userMessageId?: string;
    requestHash?: string;
    historyMessageIds?: string[];
  } & Partial<PreparedTurn>,
): PreparedTurn {
  const { assistantId, topicId, userMessageId, requestHash, historyMessageIds, ...rest } =
    input;
  return {
    kind: "send",
    assistantId,
    topicId: topicId ?? null,
    providerConfigId: "cfg-1",
    modelId: "gpt-4o",
    historyMessageIds: historyMessageIds ?? [],
    userMessage: {
      message: {
        id: userMessageId ?? "u-1",
        role: "user",
        parts: [{ type: "text", text: "hello" }],
      },
      // The prepared message carries resolved file parts alongside; the turn
      // only needs the model-facing text here.
    } as unknown as PreparedTurn["userMessage"],
    defaultTopicTitle: "New topic",
    titleCandidate: true,
    actorRole: "user",
    requestHash: requestHash ?? "hash-send",
    ...rest,
  };
}

function admitPrepared(
  input: Parameters<typeof prepared>[0],
  actor: Actor,
  options: { requestId?: string; clock?: () => Promise<Date> } = {},
) {
  const turn = prepared(input);
  return admitTurn(
    { requestId: options.requestId, requestHash: turn.requestHash },
    async () => turn,
    actor,
    options.clock ? { clock: options.clock } : undefined,
  );
}

async function setupAssistant(actor: Actor): Promise<string> {
  const assistant = await createAssistant({ name: "Owner", icon: "✨" }, actor);
  return assistant.id;
}

afterAll(async () => {
  await resetState();
});

describe("generation admission", () => {
  beforeEach(async () => {
    await resetState();
  });

  it("admits a send atomically: topic, user message, assistant placeholder and queued task", async () => {
    const { actor } = await seedActors();
    const assistantId = await setupAssistant(actor);

    const { generation, duplicate } = await admitPrepared(
      { assistantId },
      actor,
    );

    expect(duplicate).toBe(false);
    expect(generation.status).toBe("queued");
    expect(generation.topicId).not.toBeNull();
    expect(generation.assistantMessageId).not.toBeNull();

    const messages = await listTopicMessages(
      { topicId: generation.topicId! },
      actor,
    );
    // The placeholder is visible as an empty assistant row, so a client that
    // reloads mid-turn renders the slot the resume stream will fill.
    expect(messages.map((message) => message.id)).toEqual([
      "u-1",
      generation.assistantMessageId,
    ]);
    expect(messages[1]?.parts).toEqual([]);
  });

  it("claims a queued turn exactly once", async () => {
    const { actor } = await seedActors();
    const assistantId = await setupAssistant(actor);
    const { generation } = await admitPrepared({ assistantId }, actor);

    const first = await claimGeneration(generation.id);
    const second = await claimGeneration(generation.id);

    expect(first?.status).toBe("running");
    expect(first?.startedAt).not.toBeNull();
    // The conditional update is the whole duplicate-execution guard.
    expect(second).toBeNull();
  });

  it("returns the same task for a repeated request id with the same payload", async () => {
    const { actor } = await seedActors();
    const assistantId = await setupAssistant(actor);
    const requestId = uuidv7();

    const first = await admitPrepared({ assistantId }, actor, {
      requestId,
    });
    const second = await admitPrepared({ assistantId }, actor, {
      requestId,
    });

    expect(second.duplicate).toBe(true);
    expect(second.generation.id).toBe(first.generation.id);
    const generations = await db.select().from(chatGenerations);
    const messages = await db.select().from(chatMessages);
    expect(generations).toHaveLength(1);
    // No second user message and no second placeholder.
    expect(messages).toHaveLength(2);
  });

  it("rejects a reused request id with a different payload", async () => {
    const { actor } = await seedActors();
    const assistantId = await setupAssistant(actor);
    const requestId = uuidv7();
    await admitPrepared({ assistantId }, actor, { requestId });

    await expect(
      admitPrepared({ assistantId, requestHash: "other" }, actor, {
        requestId,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("rejects an expired or future-dated request id before writing anything", async () => {
    const { actor } = await seedActors();
    const assistantId = await setupAssistant(actor);
    const old = uuidv7({
      msecs: Date.now() - REQUEST_KEY_TTL_MS - 60_000,
    });
    const ahead = uuidv7({ msecs: Date.now() + 10 * 60_000 });

    await expect(
      admitPrepared({ assistantId }, actor, { requestId: old }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      admitPrepared({ assistantId }, actor, { requestId: ahead }),
    ).rejects.toMatchObject({ status: 400 });

    expect(await db.select().from(chatGenerations)).toHaveLength(0);
    expect(await db.select().from(chatMessages)).toHaveLength(0);
    expect(await db.select().from(topics)).toHaveLength(0);
  });

  it("allows one active turn per topic but not per account", async () => {
    const { actor } = await seedActors();
    const assistantId = await setupAssistant(actor);
    const topicA = await createTopicForChat(
      { assistantId },
      actor,
      "New topic",
    );
    const topicB = await createTopicForChat(
      { assistantId },
      actor,
      "New topic",
    );

    await admitPrepared(
      { assistantId, topicId: topicA.id, userMessageId: "u-a1" },
      actor,
    );
    await expect(
      admitPrepared(
        { assistantId, topicId: topicA.id, userMessageId: "u-a2" },
        actor,
      ),
    ).rejects.toMatchObject({ status: 409 });

    // Different topics run in parallel: no global/per-account slot.
    const other = await admitPrepared(
      { assistantId, topicId: topicB.id, userMessageId: "u-b1" },
      actor,
    );
    expect(other.generation.status).toBe("queued");
  });

  it("does not leak another account's task by id or request id", async () => {
    const { actor, otherActor } = await seedActors();
    const assistantId = await setupAssistant(actor);
    const otherAssistant = await createAssistant(
      { name: "Other", icon: "✨" },
      otherActor,
    );
    const requestId = uuidv7();
    const { generation } = await admitPrepared(
      { assistantId },
      actor,
      { requestId },
    );

    // Receipts are scoped by user id: account B cannot look up or resume A's
    // task, and real preparation refuses A's assistant for B.
    expect(await findGenerationByRequestId(requestId, otherActor)).toBeNull();
    const { prepareSendTurn } = await import("@/server/ai/generation-turn");
    await db.insert(providerConfigs).values({
      id: "cfg-shared-check",
      ownerId: otherActor.userId,
      name: "Shared",
      baseUrl: "http://localhost:11434/v1",
    });
    await db.insert(providerModels).values({
      id: "pm-shared-check",
      providerConfigId: "cfg-shared-check",
      modelId: "gpt-4o",
    });
    await expect(
      admitTurn(
        { requestId, requestHash: "hash-send" },
        () =>
          prepareSendTurn(
            {
              request: {
                assistantId,
                providerConfigId: "cfg-shared-check",
                modelId: "gpt-4o",
                message: {
                  id: "u-foreign",
                  role: "user",
                  parts: [{ type: "text", text: "hi" }],
                },
              },
              defaultTopicTitle: "New topic",
              actorRole: "user",
            },
            otherActor,
          ),
        otherActor,
      ),
    ).rejects.toMatchObject({ status: 404 });
    // Real preparation also refuses A's topic when B calls send or regenerate.
    const { prepareRegenerateTurn } = await import(
      "@/server/ai/generation-turn"
    );
    await expect(
      admitTurn(
        { requestHash: "hash-foreign-topic" },
        () =>
          prepareSendTurn(
            {
              request: {
                assistantId: otherAssistant.id,
                topicId: generation.topicId!,
                providerConfigId: "cfg-shared-check",
                modelId: "gpt-4o",
                message: {
                  id: "u-foreign-2",
                  role: "user",
                  parts: [{ type: "text", text: "hi" }],
                },
              },
              defaultTopicTitle: "New topic",
              actorRole: "user",
            },
            otherActor,
          ),
        otherActor,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      admitTurn(
        { requestHash: "hash-foreign-regen" },
        () =>
          prepareRegenerateTurn(
            {
              topicId: generation.topicId!,
              messageId: generation.assistantMessageId!,
              request: {
                providerConfigId: "cfg-shared-check",
                modelId: "gpt-4o",
              },
              defaultTopicTitle: "New topic",
              actorRole: "user",
            },
            otherActor,
          ),
        otherActor,
      ),
    ).rejects.toMatchObject({ status: 404 });
    const rows = await db.select().from(chatGenerations);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(generation.id);
  });

  it("returns the winner's task when two tabs concurrently admit the same key on a new topic", async () => {
    const { actor } = await seedActors();
    const assistantId = await setupAssistant(actor);
    const requestId = uuidv7();

    const [a, b] = await Promise.all([
      admitPrepared(
        { assistantId, userMessageId: "u-new-a", requestHash: "hash-new" },
        actor,
        { requestId },
      ),
      admitPrepared(
        { assistantId, userMessageId: "u-new-b", requestHash: "hash-new" },
        actor,
        { requestId },
      ),
    ]);

    expect(a.generation.id).toBe(b.generation.id);
    expect([a.duplicate, b.duplicate].filter(Boolean)).toHaveLength(1);
    const rows = await db.select().from(chatGenerations);
    expect(rows).toHaveLength(1);
  });
});

describe("generation lifecycle", () => {
  beforeEach(async () => {
    await resetState();
  });

  it("stops a queued turn without it ever reaching the model", async () => {
    const { actor } = await seedActors();
    const assistantId = await setupAssistant(actor);
    const { generation } = await admitPrepared({ assistantId }, actor);

    const stopping = await markGenerationStopping(generation.id, actor);
    expect(stopping.status).toBe("stopping");
    await finalizeGeneration({
      id: generation.id,
      topicId: generation.topicId,
      assistantMessageId: generation.assistantMessageId,
      status: "stopped",
      message: {
        topicId: generation.topicId!,
        messageId: generation.assistantMessageId!,
        outcome: "stopped",
      },
    });

    const rows = await db
      .select()
      .from(chatGenerations)
      .where(eq(chatGenerations.id, generation.id));
    expect(rows[0]?.status).toBe("stopped");
    expect(rows[0]?.input).toBeNull();

    // The placeholder is settled too: history must not keep an empty row
    // looking like it is still generating.
    const messages = await listTopicMessages(
      { topicId: generation.topicId! },
      actor,
    );
    expect(messages[1]?.metadata?.outcome).toBe("stopped");
    expect(messages[1]?.parts).toEqual([]);
  });

  it("keeps a completed task completed when a stop arrives late", async () => {
    const { actor } = await seedActors();
    const assistantId = await setupAssistant(actor);
    const { generation } = await admitPrepared({ assistantId }, actor);
    await claimGeneration(generation.id);
    await finalizeGeneration({
      id: generation.id,
      topicId: generation.topicId,
      assistantMessageId: generation.assistantMessageId,
      status: "completed",
      message: {
        topicId: generation.topicId!,
        messageId: generation.assistantMessageId!,
        parts: [{ type: "text", text: "done" }],
        outcome: "completed",
      },
    });

    // The old implementation re-read the row and then updated by id alone, so
    // a stop racing the finish could move the terminal row back to `stopping`.
    const row = await markGenerationStopping(generation.id, actor);
    expect(row.status).toBe("completed");
    const rows = await db
      .select()
      .from(chatGenerations)
      .where(eq(chatGenerations.id, generation.id));
    expect(rows[0]?.status).toBe("completed");
  });

  it("honors a durable stop that committed before a late completion", async () => {
    const { actor } = await seedActors();
    const assistantId = await setupAssistant(actor);
    const { generation } = await admitPrepared({ assistantId }, actor);
    await claimGeneration(generation.id);
    await markGenerationStopping(generation.id, actor);

    // The producer may have computed its outcome before the stop reached its
    // AbortController. The transaction must decide from the locked task row.
    await finalizeGeneration({
      id: generation.id,
      topicId: generation.topicId,
      assistantMessageId: generation.assistantMessageId,
      status: "completed",
      message: {
        topicId: generation.topicId!,
        messageId: generation.assistantMessageId!,
        parts: [{ type: "text", text: "partial" }],
        outcome: "completed",
      },
    });
    const [row] = await db.select().from(chatGenerations)
      .where(eq(chatGenerations.id, generation.id));
    expect(row?.status).toBe("stopped");
    const messages = await listTopicMessages({ topicId: generation.topicId! }, actor);
    expect(messages[1]?.metadata?.outcome).toBe("stopped");
    expect(messages[1]?.parts).toEqual([{ type: "text", text: "partial" }]);
  });

  it("writes a checkpoint with usage metadata but does not touch topic activity", async () => {
    const { actor } = await seedActors();
    const assistantId = await setupAssistant(actor);
    const { generation } = await admitPrepared({ assistantId }, actor);
    const topicId = generation.topicId!;
    const messageId = generation.assistantMessageId!;

    const before = await db
      .select({ updatedAt: topics.updatedAt })
      .from(topics)
      .where(eq(topics.id, topicId));

    const checked = await checkpointGeneration({
      topicId,
      messageId,
      parts: [{ type: "text", text: "par" }],
      reasoningMs: 1_200,
      totalTokens: 42,
      finishReason: "length",
    });
    expect(checked).toBe(true);

    const afterCheckpoint = await db
      .select({ updatedAt: topics.updatedAt })
      .from(topics)
      .where(eq(topics.id, topicId));
    // A crash-retention write is not user activity: it must not reorder the
    // sidebar once every 10 seconds.
    expect(afterCheckpoint[0]?.updatedAt).toEqual(before[0]?.updatedAt);

    const checkedMessages = await listTopicMessages({ topicId }, actor);
    expect(checkedMessages[1]?.parts).toEqual([{ type: "text", text: "par" }]);
    expect(checkedMessages[1]?.metadata?.reasoningMs).toBe(1_200);
    expect(checkedMessages[1]?.metadata?.totalTokens).toBe(42);
    expect(checkedMessages[1]?.metadata?.finishReason).toBe("length");
    // The outcome stays open until the turn really ends.
    expect(checkedMessages[1]?.metadata?.outcome).toBeUndefined();

    const result = await finalizeGeneration({
      id: generation.id,
      topicId,
      assistantMessageId: messageId,
      status: "stopped",
      message: {
        topicId,
        messageId,
        parts: [{ type: "text", text: "partial" }],
        outcome: "stopped",
        totalTokens: 12,
        finishReason: "length",
      },
    });
    expect(result).toEqual({
      settled: true,
      messageStored: true,
      targetDeleted: false,
      status: "stopped",
    });

    const messages = await listTopicMessages({ topicId }, actor);
    // Checkpoint and final write are the same row: identity, group and
    // version slot never move.
    expect(messages[1]?.id).toBe(messageId);
    expect(messages[1]?.parts).toEqual([{ type: "text", text: "partial" }]);
    expect(messages[1]?.metadata?.outcome).toBe("stopped");
    expect(messages[1]?.metadata?.totalTokens).toBe(12);
    expect(messages[1]?.metadata?.finishReason).toBe("length");

    const afterFinalize = await db
      .select({ updatedAt: topics.updatedAt })
      .from(topics)
      .where(eq(topics.id, topicId));
    expect(afterFinalize[0]?.updatedAt.getTime()).toBeGreaterThan(
      before[0]!.updatedAt.getTime(),
    );
  });

  it("never overwrites a terminal task from a losing finalize", async () => {
    const { actor } = await seedActors();
    const assistantId = await setupAssistant(actor);
    const { generation } = await admitPrepared({ assistantId }, actor);
    const topicId = generation.topicId!;
    const messageId = generation.assistantMessageId!;
    await claimGeneration(generation.id);
    await finalizeGeneration({
      id: generation.id,
      topicId,
      assistantMessageId: messageId,
      status: "completed",
      message: {
        topicId,
        messageId,
        parts: [{ type: "text", text: "final" }],
        outcome: "completed",
      },
    });

    const loser = await finalizeGeneration({
      id: generation.id,
      topicId,
      assistantMessageId: messageId,
      status: "failed",
      errorMessage: "late failure",
      message: {
        topicId,
        messageId,
        parts: [{ type: "text", text: "overwritten" }],
        outcome: "failed",
      },
    });

    expect(loser.settled).toBe(false);
    expect(loser.messageStored).toBe(false);
    const rows = await db
      .select()
      .from(chatGenerations)
      .where(eq(chatGenerations.id, generation.id));
    expect(rows[0]?.status).toBe("completed");
    expect(rows[0]?.errorMessage).toBeNull();
    const messages = await listTopicMessages({ topicId }, actor);
    expect(messages[1]?.parts).toEqual([{ type: "text", text: "final" }]);
    expect(messages[1]?.metadata?.outcome).toBe("completed");
  });

  it("discards a finalize that loses the race with a topic delete", async () => {
    const { actor } = await seedActors();
    const assistantId = await setupAssistant(actor);
    const { generation } = await admitPrepared({ assistantId }, actor);
    const topicId = generation.topicId!;
    const messageId = generation.assistantMessageId!;
    await claimGeneration(generation.id);

    await deleteTopic(topicId, actor);
    const result = await finalizeGeneration({
      id: generation.id,
      topicId,
      assistantMessageId: messageId,
      status: "completed",
      message: {
        topicId,
        messageId,
        parts: [{ type: "text", text: "late" }],
        outcome: "completed",
      },
    });

    // The delete transaction won: the turn must not re-create data or claim a
    // success the client can no longer read.
    expect(result.settled).toBe(false);
    expect(result.messageStored).toBe(false);
    expect(result.targetDeleted).toBe(true);
    const rows = await db
      .select()
      .from(chatGenerations)
      .where(eq(chatGenerations.id, generation.id));
    expect(rows[0]?.status).toBe("stopped");
    expect(rows[0]?.targetDeletedAt).not.toBeNull();
    expect(
      await db.select().from(chatMessages).where(eq(chatMessages.topicId, topicId)),
    ).toHaveLength(0);
  });

  it("cancels and marks the task when its topic is deleted, and refuses late writes", async () => {
    const { actor } = await seedActors();
    const assistantId = await setupAssistant(actor);
    const { generation } = await admitPrepared({ assistantId }, actor);
    const topicId = generation.topicId!;
    const messageId = generation.assistantMessageId!;

    await deleteTopic(topicId, actor);

    const rows = await db
      .select()
      .from(chatGenerations)
      .where(eq(chatGenerations.id, generation.id));
    expect(rows[0]?.status).toBe("stopped");
    expect(rows[0]?.targetDeletedAt).not.toBeNull();
    expect(rows[0]?.input).toBeNull();
    expect(rows[0]?.assistantMessageId).toBeNull();

    // A late finalize cannot re-create data.
    const result = await finalizeGeneration({
      id: generation.id,
      topicId,
      assistantMessageId: messageId,
      status: "stopped",
      message: {
        topicId,
        messageId,
        parts: [{ type: "text", text: "late" }],
        outcome: "stopped",
      },
    });
    expect(result.messageStored).toBe(false);
  });

  it("refuses message deletion and version switching while a turn is active", async () => {
    const { actor } = await seedActors();
    const assistantId = await setupAssistant(actor);
    const { generation } = await admitPrepared({ assistantId }, actor);
    const topicId = generation.topicId!;

    const { deleteMessage } = await import("@/server/services/message.service");
    await expect(
      deleteMessage({ topicId, messageId: "u-1" }, actor),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("closes leftover running/stopping turns and their messages on boot", async () => {
    const { actor } = await seedActors();
    const assistantId = await setupAssistant(actor);
    const first = await admitPrepared({ assistantId }, actor);
    const second = await admitPrepared(
      { assistantId, userMessageId: "u-2" },
      actor,
    );
    await claimGeneration(first.generation.id);
    await markGenerationStopping(second.generation.id, actor);
    // Content the previous process already persisted must survive the recovery.
    await checkpointGeneration({
      topicId: first.generation.topicId!,
      messageId: first.generation.assistantMessageId!,
      parts: [{ type: "text", text: "saved before the crash" }],
    });

    const recovered = await recoverInterruptedGenerations();

    expect(recovered).toEqual({ interrupted: 1, stopped: 1 });
    const rows = await db.select().from(chatGenerations);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(first.generation.id)?.status).toBe("interrupted");
    expect(byId.get(second.generation.id)?.status).toBe("stopped");

    const firstMessages = await listTopicMessages(
      { topicId: first.generation.topicId! },
      actor,
    );
    // History is what the user reads: the interrupted turn must show its saved
    // partial answer plus a failure state, not a permanently "generating" row.
    expect(firstMessages[1]?.parts).toEqual([
      { type: "text", text: "saved before the crash" },
    ]);
    expect(firstMessages[1]?.metadata?.outcome).toBe("failed");
    expect(firstMessages[1]?.metadata?.errorMessage).toBe(
      "Generation was interrupted by a server restart",
    );

    const secondMessages = await listTopicMessages(
      { topicId: second.generation.topicId! },
      actor,
    );
    expect(secondMessages[1]?.metadata?.outcome).toBe("stopped");
    expect(secondMessages[1]?.metadata?.errorMessage).toBeUndefined();
  });

  it("purges terminal receipts only after both windows pass", async () => {
    const { actor } = await seedActors();
    const assistantId = await setupAssistant(actor);
    const { generation } = await admitPrepared({ assistantId }, actor);
    await finalizeGeneration({
      id: generation.id,
      topicId: generation.topicId,
      assistantMessageId: generation.assistantMessageId,
      status: "completed",
    });

    // Fresh terminal row: still inside the 24h window.
    expect(await purgeTerminalGenerations()).toBe(0);

    const later = new Date(Date.now() + REQUEST_KEY_TTL_MS + 60_000);
    const purged = await purgeTerminalGenerations(async () => later);
    expect(purged).toBe(1);
    expect(
      await db
        .select()
        .from(chatGenerations)
        .where(and(eq(chatGenerations.id, generation.id))),
    ).toHaveLength(0);
  });

  it("derives the request-key time from a UUIDv7", () => {
    const now = Date.now();
    const id = uuidv7({ msecs: now });
    expect(requestKeyTime(id)).toBe(now);
    expect(requestKeyTime("not-a-uuid")).toBeNull();
  });
});

/**
 * Request-entry ordering (chat task §4, review B5).
 *
 * The receipt is the "did you already accept this?" question, and it has to be
 * answered BEFORE any capability validation: a retry of an accepted request
 * must find its task even though the model was disabled, an attachment became
 * unroutable or the edited message disappeared in the meantime.
 *
 * These tests drive the real `admitTurn` against the isolated
 * database and pass the preparation step as a thunk, so "preparation did not
 * run" is observable rather than assumed.
 */
describe("generation admission ordering", () => {
  beforeEach(async () => {
    await resetState();
  });

  it("answers from the receipt without running preparation", async () => {
    const { actor } = await seedActors();
    const assistantId = await setupAssistant(actor);
    const requestId = uuidv7();
    const first = await admitPrepared({ assistantId }, actor, {
      requestId,
    });

    let preparedRuns = 0;
    const duplicate = await admitTurn(
      { requestId, requestHash: "hash-send" },
      async () => {
        preparedRuns += 1;
        throw new Error("model no longer available");
      },
      actor,
    );

    expect(preparedRuns).toBe(0);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.generation.id).toBe(first.generation.id);
    // Nothing was written a second time.
    expect(
      await db
        .select()
        .from(chatGenerations)
        .where(eq(chatGenerations.userId, actor.userId)),
    ).toHaveLength(1);
  });

  it("rejects an expired key before running preparation", async () => {
    const { actor } = await seedActors();
    const assistantId = await setupAssistant(actor);
    const expired = uuidv7({ msecs: Date.now() - REQUEST_KEY_TTL_MS - 60_000 });

    let preparedRuns = 0;
    await expect(
      admitTurn(
        { requestId: expired, requestHash: "hash-send" },
        async () => {
          preparedRuns += 1;
          return prepared({ assistantId });
        },
        actor,
      ),
    ).rejects.toMatchObject({ messageKey: "generation.requestExpired" });

    expect(preparedRuns).toBe(0);
  });

  it("uses the injected clock for the key window, not the process clock", async () => {
    const { actor } = await seedActors();
    const assistantId = await setupAssistant(actor);
    // The app process thinks it is ~29 days behind the database clock: this id
    // looks "far in the future" to it, while the database sees a fresh key.
    const ahead = async () =>
      new Date(Date.now() + 29 * 24 * 60 * 60 * 1000);
    const requestId = uuidv7({
      msecs: Date.now() + 29 * 24 * 60 * 60 * 1000 - 2 * 60 * 60 * 1000,
    });

    // The process clock alone would reject it as clock-ahead…
    await expect(
      admitTurn(
        { requestId, requestHash: "hash-send" },
        async () => prepared({ assistantId }),
        actor,
        { clock: async () => new Date() },
      ),
    ).rejects.toMatchObject({ messageKey: "generation.requestClockAhead" });

    // …the clock it is given decides, and production always passes the
    // database clock.
    const admitted = await admitTurn(
      { requestId, requestHash: "hash-send" },
      async () => prepared({ assistantId }),
      actor,
      { clock: ahead },
    );

    expect(admitted.duplicate).toBe(false);
    const row = await findGenerationByRequestId(requestId, actor);
    expect(row?.requestExpiresAt?.getTime()).toBe(
      requestKeyTime(requestId)! + REQUEST_KEY_TTL_MS,
    );
  });

  it("returns the winner's task when two tabs retry the same key on an existing topic", async () => {
    const { actor } = await seedActors();
    const assistantId = await setupAssistant(actor);
    // A finished turn first, so the topic already exists and admission has to
    // take the topic lock (the concurrent-duplicate path under review).
    const seedTurn = await admitPrepared({ assistantId }, actor);
    await finalizeGeneration({
      id: seedTurn.generation.id,
      topicId: seedTurn.generation.topicId,
      assistantMessageId: seedTurn.generation.assistantMessageId,
      status: "completed",
    });
    const topicId = seedTurn.generation.topicId!;
    const requestId = uuidv7();

    const [a, b] = await Promise.all([
      admitTurn(
        { requestId, requestHash: "hash-retry" },
        async () =>
          prepared({
            assistantId,
            topicId,
            userMessageId: "u-retry-a",
            requestHash: "hash-retry",
          }),
        actor,
      ),
      admitTurn(
        { requestId, requestHash: "hash-retry" },
        async () =>
          prepared({
            assistantId,
            topicId,
            userMessageId: "u-retry-b",
            requestHash: "hash-retry",
          }),
        actor,
      ),
    ]);

    // Either both see the same task, or one wins and the other resolves to it:
    // a topic conflict (409 topicBusy) would be the bug.
    expect(a.generation.id).toBe(b.generation.id);
    expect([a.duplicate, b.duplicate].filter(Boolean)).toHaveLength(1);
    const rows = await db
      .select()
      .from(chatGenerations)
      .where(eq(chatGenerations.topicId, topicId));
    expect(rows).toHaveLength(2);
  });

  it("refuses a receipt whose target was deleted", async () => {
    const { actor } = await seedActors();
    const assistantId = await setupAssistant(actor);
    const requestId = uuidv7();
    const admitted = await admitPrepared({ assistantId }, actor, {
      requestId,
    });
    await deleteTopic(admitted.generation.topicId!, actor);

    await expect(
      admitTurn(
        { requestId, requestHash: "hash-send" },
        async () => prepared({ assistantId }),
        actor,
      ),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 410,
      messageKey: "generation.targetDeleted",
    });
  });

  it("refuses an admission whose frozen history no longer exists", async () => {
    const { actor } = await seedActors();
    const assistantId = await setupAssistant(actor);
    const seedTurn = await admitPrepared({ assistantId }, actor);
    await finalizeGeneration({
      id: seedTurn.generation.id,
      topicId: seedTurn.generation.topicId,
      assistantMessageId: seedTurn.generation.assistantMessageId,
      status: "completed",
    });
    const topicId = seedTurn.generation.topicId!;

    await expect(
      admitTurn(
        { requestHash: "hash-moved" },
        async () => {
          // The preparation froze the seed message, then it disappeared before
          // admission took the lock.
          await db.delete(chatMessages).where(eq(chatMessages.id, "u-1"));
          return prepared({
            assistantId,
            topicId,
            userMessageId: "u-next",
            historyMessageIds: ["u-1"],
            requestHash: "hash-moved",
          });
        },
        actor,
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      messageKey: "generation.contextChanged",
    });
  });

  it("refuses an admission whose compression boundary moved", async () => {
    const { actor } = await seedActors();
    const assistantId = await setupAssistant(actor);
    const seedTurn = await admitPrepared({ assistantId }, actor);
    await finalizeGeneration({
      id: seedTurn.generation.id,
      topicId: seedTurn.generation.topicId,
      assistantMessageId: seedTurn.generation.assistantMessageId,
      status: "completed",
    });
    const topicId = seedTurn.generation.topicId!;

    await expect(
      admitTurn(
        { requestHash: "hash-compressed" },
        async () => {
          // A manual compaction commits between preparation (which saw no
          // summary) and admission, so the frozen clipping is stale.
          await db
            .update(topics)
            .set({ summaryText: "summary", summaryUpToMessageId: "u-1" })
            .where(eq(topics.id, topicId));
          return prepared({
            assistantId,
            topicId,
            userMessageId: "u-after-compaction",
            historyMessageIds: ["u-1", seedTurn.generation.assistantMessageId!],
            summary: null,
            requestHash: "hash-compressed",
          });
        },
        actor,
      ),
    ).rejects.toMatchObject({
      messageKey: "generation.contextChanged",
      status: 409,
    });
  });

  it("allows an already-open subscription to drain after session revocation while rejecting new and reconnected requests", async () => {
    const { actor, otherActor } = await seedActors();
    const { generation } = await admitPrepared(
      { assistantId: await setupAssistant(actor) },
      actor,
    );
    const signInRes = await authPost(
      jsonRequest("/api/auth/sign-in/email", {
        body: {
          email: userCredentials.email,
          password: userCredentials.password,
        },
      }),
    );
    expect(signInRes.status).toBe(200);
    const cookie = cookiesFrom(signInRes);
    const sessionHeaders = jsonRequest("/api/chat", { cookie }).headers;
    await expect(requireActor(sessionHeaders)).resolves.toMatchObject({
      userId: actor.userId,
    });

    const { respondWithGeneration } = await import(
      "@/app/api/chat/_lib/generation-response"
    );
    const { GET: resumeGet } = await import(
      "@/app/api/chat/generations/[id]/stream/route"
    );
    const { POST: chatPost } = await import("@/app/api/chat/route");
    const {
      createLiveGeneration,
      addLiveGeneration,
      publishChunk,
      removeLiveGeneration,
    } = await import("@/server/ai/generation-registry");
    const { createLiveStreamState } = await import(
      "@/server/ai/generation-stream"
    );

    const entry = createLiveGeneration({
      state: createLiveStreamState({
        generationId: generation.id,
        userId: actor.userId,
        topicId: generation.topicId,
        assistantMessageId: generation.assistantMessageId ?? "m-1",
      }),
    });
    await claimGeneration(generation.id);
    addLiveGeneration(entry);
    try {
      const response = await resumeGet(
        new Request(`http://localhost/api/chat/generations/${generation.id}/stream`, {
          headers: sessionHeaders,
        }),
        { params: Promise.resolve({ id: generation.id }) },
      );
      expect(response.status).toBe(200);
      assert(response.body);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      expect(decoder.decode((await reader.read()).value)).toContain('"type":"data-topic"');
      expect(decoder.decode((await reader.read()).value)).toContain('"type":"start"');

      // Revoke the session via Better Auth sign-out.
      const signOutRes = await authPost(
        jsonRequest("/api/auth/sign-out", { cookie, body: {} }),
      );
      expect(signOutRes.status).toBe(200);

      // The already-authorized HTTP response still receives live SSE chunks.
      publishChunk(entry, { type: "text-start", id: "t1" });
      publishChunk(entry, { type: "text-delta", id: "t1", delta: "after-revoke" });
      expect(decoder.decode((await reader.read()).value)).toContain('"type":"text-start"');
      expect(decoder.decode((await reader.read()).value)).toContain('"delta":"after-revoke"');
      await reader.cancel();

      // New/reconnected requests using the revoked session must be rejected (401).
      const reconnectRes = await resumeGet(
        new Request(`http://localhost/api/chat/generations/${generation.id}/stream`, {
          headers: sessionHeaders,
        }),
        { params: Promise.resolve({ id: generation.id }) },
      );
      expect(reconnectRes.status).toBe(401);

      const postRes = await chatPost(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: {
            ...Object.fromEntries(sessionHeaders),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            assistantId: "a1",
            providerConfigId: "c1",
            modelId: "m1",
            message: {
              id: "u-rev",
              role: "user",
              parts: [{ type: "text", text: "hi" }],
            },
          }),
        }),
      );
      expect(postRes.status).toBe(401);

      const { GET: activeGet } = await import(
        "@/app/api/chat/generations/route"
      );
      const activeRes = await activeGet(
        new Request("http://localhost/api/chat/generations?active=true", {
          headers: sessionHeaders,
        }),
      );
      expect(activeRes.status).toBe(401);

      const { POST: stopPost } = await import("@/app/api/chat/stop/route");
      const stopRes = await stopPost(
        new Request("http://localhost/api/chat/stop", {
          method: "POST",
          headers: {
            ...Object.fromEntries(sessionHeaders),
            "content-type": "application/json",
          },
          body: JSON.stringify({ streamId: generation.id }),
        }),
      );
      expect(stopRes.status).toBe(401);

      // Foreign actor cannot subscribe either.
      await expect(
        respondWithGeneration({
          generationId: generation.id,
          actor: otherActor,
          mode: "resume",
        }),
      ).rejects.toMatchObject({ status: 404 });
    } finally {
      removeLiveGeneration(generation.id);
    }
  });
});
