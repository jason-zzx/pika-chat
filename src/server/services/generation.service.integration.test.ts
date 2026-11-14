import "server-only";

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterAll, describe, expect, it } from "vitest";

import { requireActor } from "@/server/auth/actor";
import {
  authPost,
  cookiesFrom,
  jsonRequest,
  userCredentials,
} from "@/server/auth/auth-test-helpers";
import { stopGenerationById } from "@/server/ai/generation-runner";
import { prepareRegenerateTurn, prepareSendTurn } from "@/server/ai/generation-turn";
import { requireModelForActor } from "@/server/ai/require-model";
import { getDb } from "@/server/db/client";
import {
  chatGenerations,
  chatMessages,
  providerConfigs,
  providerModels,
  topics,
} from "@/server/db/schema";
import { createAssistant } from "@/server/services/assistant.service";
import { compressTopicHistory } from "@/server/services/compression.service";
import {
  REQUEST_KEY_TTL_MS,
  admitTurn,
  checkpointGeneration,
  claimGeneration,
  finalizeGeneration,
  findGenerationByRequestId,
  markGenerationStopping,
  purgeTerminalGenerations,
} from "@/server/services/generation.service";
import {
  deleteMessage,
  listTopicMessages,
  selectMessageVersion,
} from "@/server/services/message.service";
import { createTopicForChat, deleteTopic } from "@/server/services/topic.service";
import {
  admitPrepared,
  generationRow,
  preparedTurn,
  resetState,
  seedChat,
} from "@/test-utils/generation-harness";

const db = getDb();
// Admission and finalization never call the provider.
const unreachableProvider = "http://127.0.0.1:9/v1";

afterAll(resetState);

describe("generation admission", () => {
  it("admits a send atomically: topic, user message, assistant placeholder and queued task", async () => {
    const { actor, assistantId } = await seedChat(unreachableProvider);

    const { generation, duplicate } = await admitPrepared(preparedTurn({ assistantId }), actor);

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

  it("rejects a reused request id with a different payload", async () => {
    const { actor, assistantId } = await seedChat(unreachableProvider);
    const requestId = uuidv7();
    await admitPrepared(preparedTurn({ assistantId }), actor, { requestId });

    await expect(
      admitPrepared(preparedTurn({ assistantId, requestHash: "other" }), actor, { requestId }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("allows one active turn per topic but not per account, and refuses context changes while active", async () => {
    const { actor, assistantId, topicId } = await seedChat(unreachableProvider);
    const topicB = await createTopicForChat(
      { assistantId },
      actor,
      "New topic",
    );

    await admitPrepared(preparedTurn({ assistantId, topicId, userMessageId: "u-a1" }), actor);
    await expect(
      admitPrepared(preparedTurn({ assistantId, topicId, userMessageId: "u-a2" }), actor),
    ).rejects.toMatchObject({ status: 409 });
    // Deleting, switching versions or manually compressing would change the
    // context the active turn was planned against.
    await expect(
      deleteMessage({ topicId, messageId: "u-a1" }, actor),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      selectMessageVersion({ topicId, messageId: "u-a1" }, actor),
    ).rejects.toMatchObject({ status: 409 });
    const { handle } = await requireModelForActor(
      { providerConfigId: "cfg-local", modelId: "gpt-4o" },
      actor,
    );
    // The manual path keeps the topic lock for the whole operation, so an
    // active turn is a hard conflict rather than a race with the summary write.
    await expect(
      compressTopicHistory({ topicId, handle, exclusive: true }, actor),
    ).rejects.toMatchObject({ messageKey: "generation.topicBusy" });

    // Different topics run in parallel: no global/per-account slot.
    const other = await admitPrepared(
      preparedTurn({ assistantId, topicId: topicB.id, userMessageId: "u-b1" }),
      actor,
    );
    expect(other.generation.status).toBe("queued");
  });

  it("does not leak another account's task by id or request id", async () => {
    const { actor, otherActor, assistantId } = await seedChat(unreachableProvider);
    const otherAssistant = await createAssistant(
      { name: "Other", icon: "✨" },
      otherActor,
    );
    const requestId = uuidv7();
    const { generation } = await admitPrepared(preparedTurn({ assistantId }), actor, { requestId });

    // Receipts are scoped by user id: account B cannot look up or resume A's
    // task, and real preparation refuses A's assistant for B.
    expect(await findGenerationByRequestId(requestId, otherActor)).toBeNull();
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
    // B cannot stop A's task either: it does not exist for B, and A's task is
    // left exactly as it was.
    await expect(stopGenerationById(generation.id, otherActor)).rejects.toMatchObject({
      status: 404,
      messageKey: "generation.notFound",
    });
    expect(await generationRow(generation.id)).toEqual(generation);
  });

  it("returns the winner's task when two tabs concurrently admit the same key on a new topic", async () => {
    const { actor, assistantId } = await seedChat(unreachableProvider);
    const requestId = uuidv7();

    const [a, b] = await Promise.all([
      admitPrepared(
        preparedTurn({ assistantId, userMessageId: "u-new-a", requestHash: "hash-new" }),
        actor,
        { requestId },
      ),
      admitPrepared(
        preparedTurn({ assistantId, userMessageId: "u-new-b", requestHash: "hash-new" }),
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
  it("keeps a completed task completed when a stop arrives late", async () => {
    const { actor, assistantId } = await seedChat(unreachableProvider);
    const { generation } = await admitPrepared(preparedTurn({ assistantId }), actor);
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
    expect((await generationRow(generation.id))?.status).toBe("completed");
  });

  it("honors a durable stop that committed before a late completion", async () => {
    const { actor, assistantId } = await seedChat(unreachableProvider);
    const { generation } = await admitPrepared(preparedTurn({ assistantId }), actor);
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
    expect((await generationRow(generation.id))?.status).toBe("stopped");
    const messages = await listTopicMessages({ topicId: generation.topicId! }, actor);
    expect(messages[1]?.metadata?.outcome).toBe("stopped");
    expect(messages[1]?.parts).toEqual([{ type: "text", text: "partial" }]);
  });

  it("writes a checkpoint with usage metadata but does not touch topic activity", async () => {
    const { actor, assistantId } = await seedChat(unreachableProvider);
    const { generation } = await admitPrepared(preparedTurn({ assistantId }), actor);
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
    const { actor, assistantId } = await seedChat(unreachableProvider);
    const { generation } = await admitPrepared(preparedTurn({ assistantId }), actor);
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
    const row = await generationRow(generation.id);
    expect(row?.status).toBe("completed");
    expect(row?.errorMessage).toBeNull();
    const messages = await listTopicMessages({ topicId }, actor);
    expect(messages[1]?.parts).toEqual([{ type: "text", text: "final" }]);
    expect(messages[1]?.metadata?.outcome).toBe("completed");
  });

  it("discards a finalize that loses the race with a topic delete", async () => {
    const { actor, assistantId } = await seedChat(unreachableProvider);
    const { generation } = await admitPrepared(preparedTurn({ assistantId }), actor);
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
    const row = await generationRow(generation.id);
    expect(row?.status).toBe("stopped");
    expect(row?.targetDeletedAt).not.toBeNull();
    // The tombstone keeps no input or message reference of the deleted topic.
    expect(row?.input).toBeNull();
    expect(row?.assistantMessageId).toBeNull();
    expect(
      await db.select().from(chatMessages).where(eq(chatMessages.topicId, topicId)),
    ).toHaveLength(0);
  });

  it("purges terminal receipts only after the receipt window passes", async () => {
    const { actor, assistantId } = await seedChat(unreachableProvider);
    const { generation } = await admitPrepared(preparedTurn({ assistantId }), actor);
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
    expect(await generationRow(generation.id)).toBeUndefined();
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
  it("answers from the receipt without running preparation", async () => {
    const { actor, assistantId } = await seedChat(unreachableProvider);
    const requestId = uuidv7();
    const first = await admitPrepared(preparedTurn({ assistantId }), actor, { requestId });

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
    // Nothing was written a second time: no second task, user message or
    // placeholder.
    expect(
      await db
        .select()
        .from(chatGenerations)
        .where(eq(chatGenerations.userId, actor.userId)),
    ).toHaveLength(1);
    expect(await db.select().from(chatMessages)).toHaveLength(2);
  });

  it("rejects an expired key before running preparation", async () => {
    const { actor, assistantId } = await seedChat(unreachableProvider);
    const expired = uuidv7({ msecs: Date.now() - REQUEST_KEY_TTL_MS - 60_000 });

    let preparedRuns = 0;
    await expect(
      admitTurn(
        { requestId: expired, requestHash: "hash-send" },
        async () => {
          preparedRuns += 1;
          return preparedTurn({ assistantId });
        },
        actor,
      ),
    ).rejects.toMatchObject({ messageKey: "generation.requestExpired" });

    expect(preparedRuns).toBe(0);
  });

  it("uses the injected clock for the key window, not the process clock", async () => {
    const { actor, assistantId } = await seedChat(unreachableProvider);
    // The app process thinks it is ~29 days behind the database clock: this id
    // looks "far in the future" to it, while the database sees a fresh key.
    const ahead = async () =>
      new Date(Date.now() + 29 * 24 * 60 * 60 * 1000);
    const keyMs = Date.now() + 29 * 24 * 60 * 60 * 1000 - 2 * 60 * 60 * 1000;
    const requestId = uuidv7({ msecs: keyMs });

    // The process clock alone would reject it as clock-ahead…
    await expect(
      admitTurn(
        { requestId, requestHash: "hash-send" },
        async () => preparedTurn({ assistantId }),
        actor,
        { clock: async () => new Date() },
      ),
    ).rejects.toMatchObject({ messageKey: "generation.requestClockAhead" });

    // …the clock it is given decides, and production always passes the
    // database clock.
    const admitted = await admitTurn(
      { requestId, requestHash: "hash-send" },
      async () => preparedTurn({ assistantId }),
      actor,
      { clock: ahead },
    );

    expect(admitted.duplicate).toBe(false);
    const row = await findGenerationByRequestId(requestId, actor);
    expect(row?.requestExpiresAt?.getTime()).toBe(keyMs + REQUEST_KEY_TTL_MS);
  });

  it("returns the winner's task when two tabs retry the same key on an existing topic", async () => {
    const { actor, assistantId } = await seedChat(unreachableProvider);
    // A finished turn first, so the topic already exists and admission has to
    // take the topic lock (the concurrent-duplicate path under review).
    const seedTurn = await admitPrepared(preparedTurn({ assistantId }), actor);
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
          preparedTurn({
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
          preparedTurn({
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
    const { actor, assistantId } = await seedChat(unreachableProvider);
    const requestId = uuidv7();
    const admitted = await admitPrepared(preparedTurn({ assistantId }), actor, { requestId });
    await deleteTopic(admitted.generation.topicId!, actor);

    await expect(
      admitTurn(
        { requestId, requestHash: "hash-send" },
        async () => preparedTurn({ assistantId }),
        actor,
      ),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 410,
      messageKey: "generation.targetDeleted",
    });
  });

  it("refuses an admission whose compression boundary moved or frozen history vanished", async () => {
    const { actor, assistantId } = await seedChat(unreachableProvider);
    const seedTurn = await admitPrepared(preparedTurn({ assistantId }), actor);
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
          return preparedTurn({
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
    await db
      .update(topics)
      .set({ summaryText: null, summaryUpToMessageId: null })
      .where(eq(topics.id, topicId));

    await expect(
      admitTurn(
        { requestHash: "hash-moved" },
        async () => {
          // The preparation froze the seed message, then it disappeared before
          // admission took the lock.
          await db.delete(chatMessages).where(eq(chatMessages.id, "u-1"));
          return preparedTurn({
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

  it("allows an already-open subscription to drain after session revocation while rejecting new and reconnected requests", async () => {
    const { actor, otherActor, assistantId } = await seedChat(unreachableProvider);
    const { generation } = await admitPrepared(preparedTurn({ assistantId }), actor);
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
