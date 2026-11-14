import "server-only";

import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkpointContentOf,
  ensureGenerationRunning,
  runPostTurnTask,
  startGenerationRunner,
  stopGenerationById,
  subscribeToGeneration,
} from "@/server/ai/generation-runner";
import {
  applyChunk,
  createLiveStreamState,
  type ChatChunk,
} from "@/server/ai/generation-stream";
import { getLiveGeneration } from "@/server/ai/generation-registry";
import { getDb } from "@/server/db/client";
import { chatGenerations, chatMessages, files, topics } from "@/server/db/schema";
import { getFileStorage } from "@/server/files/storage";
import { uploadFile } from "@/server/files/file.service";
import { createAssistant, deleteAssistant } from "@/server/services/assistant.service";
import {
  checkpointGeneration,
  claimGeneration,
  markGenerationStopping,
} from "@/server/services/generation.service";
import {
  listTopicMessages,
  writeAssistantTurnRow,
} from "@/server/services/message.service";
import { createTopicForChat, deleteTopic } from "@/server/services/topic.service";
import {
  admitPrepared,
  assistantText,
  drainStream,
  generationRow,
  preparedTurn,
  resetRunner,
  seedChat,
  startFakeProvider,
  waitFor,
} from "@/test-utils/generation-harness";

/**
 * Real executor behaviour (chat task §3/§5/R8/R9).
 *
 * These tests run the actual producer against a local OpenAI-compatible HTTP
 * endpoint (no paid provider, no mocking of the turn/runner): what is asserted
 * is that the server — not a browser request — completes, saves and closes a
 * turn, and what happens to the in-memory content, the subscriptions and the
 * provider connection when the topic is deleted, the user stops the answer or
 * the process restarts.
 */

const db = getDb();
const provider = await startFakeProvider();

afterAll(() => provider.close());

beforeEach(async () => {
  provider.reset();
  await resetRunner();
});

afterEach(resetRunner);

/**
 * Attaches a client and reads until a text delta containing `marker` arrives —
 * the observable "the answer is streaming" point, without waiting for the
 * checkpoint cadence (the DB is not the live path).
 */
async function readUntilText(
  reader: ReadableStreamDefaultReader<ChatChunk>,
  marker: string,
): Promise<ChatChunk[]> {
  const seen: ChatChunk[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      throw new Error("subscription ended before the expected text arrived");
    }
    seen.push(value);
    if (value.type === "text-delta" && value.delta.includes(marker)) {
      return seen;
    }
  }
}

/** Waits until some other backend is blocked on the lock held by `pid`. */
async function waitUntilBlocking(pid: number, timeoutMs?: number): Promise<void> {
  await waitFor(async () => {
    const [blocked] = await db.execute<{ count: number }>(sql`
      select count(*)::int as count from pg_stat_activity
      where ${pid} = ANY(pg_blocking_pids(pid))
    `);
    return (blocked?.count ?? 0) > 0;
  }, timeoutMs);
}

describe("generation executor", () => {
  it("completes a turn with no browser attached and stores the answer once", async () => {
    const { actor, assistantId, topicId } = await seedChat(provider.baseUrl);
    provider.deltas = ["Hel", "lo"];
    const { generation } = await admitPrepared(preparedTurn({ assistantId, topicId }), actor);

    await ensureGenerationRunning(generation.id);
    await waitFor(async () => (await generationRow(generation.id))?.status === "completed");

    // One provider call, one stored answer — no subscription involved.
    expect(provider.calls).toHaveLength(1);
    expect(await assistantText(topicId, actor)).toBe("Hello");
    const messages = await listTopicMessages({ topicId }, actor);
    const answer = messages.find((message) => message.role === "assistant");
    expect(answer?.id).toBe(generation.assistantMessageId);
    expect(answer?.metadata?.outcome).toBe("completed");
    expect(answer?.metadata?.modelId).toBe("gpt-4o");
    expect(getLiveGeneration(generation.id)).toBeUndefined();
  });

  it("evicts a slow subscriber and ends a leaving one without cancelling the generation or stalling a healthy subscriber", async () => {
    const { actor, assistantId, topicId } = await seedChat(provider.baseUrl);
    const deltas = Array.from({ length: 1200 }, (_, i) => `c${i}-`);
    provider.deltas = deltas;
    const { generation } = await admitPrepared(preparedTurn({ assistantId, topicId }), actor);
    const entry = await ensureGenerationRunning(generation.id);
    if (!entry) throw new Error("missing live generation");

    // Unread subscriber: opens the stream and never reads from it.
    const slowSub = subscribeToGeneration(entry);
    // Healthy subscriber: drains every chunk as it arrives.
    const healthy = drainStream(subscribeToGeneration(entry).getReader());
    // Leaving subscriber: reads one chunk, then walks away like a closed tab.
    const leaving = subscribeToGeneration(entry).getReader();
    expect((await leaving.read()).done).toBe(false);
    await leaving.cancel();
    expect(entry.controller.signal.aborted).toBe(false);

    const healthyChunks = await healthy;
    await waitFor(async () => (await generationRow(generation.id))?.status === "completed");
    expect(healthyChunks.some((chunk) => chunk.type === "finish")).toBe(true);
    expect(await assistantText(topicId, actor)).toBe(deltas.join(""));
    const slowChunks = await drainStream(slowSub.getReader());
    expect(slowChunks.length).toBeLessThan(healthyChunks.length);
    expect(slowChunks.some((chunk) => chunk.type === "finish")).toBe(false);
    expect(provider.calls).toHaveLength(1);
    expect(provider.aborted).toBe(0);
  });

  it("does not call the model twice for duplicate wake-ups", async () => {
    const { actor, assistantId, topicId } = await seedChat(provider.baseUrl);
    provider.deltas = ["once"];
    provider.deltaDelayMs = 100;
    const { generation } = await admitPrepared(preparedTurn({ assistantId, topicId }), actor);

    const [first, second] = await Promise.all([
      ensureGenerationRunning(generation.id),
      ensureGenerationRunning(generation.id),
    ]);
    expect(first).toBe(second);
    // A later sweep/tick finding the same live turn must reuse it as well.
    expect(await ensureGenerationRunning(generation.id)).toBe(first);

    await waitFor(async () => (await generationRow(generation.id))?.status === "completed");
    expect(provider.calls).toHaveLength(1);
    expect(await assistantText(topicId, actor)).toBe("once");
  });

  it("tells subscribers the answer finished only after it is saved", async () => {
    const { actor, assistantId, topicId } = await seedChat(provider.baseUrl);
    provider.deltas = ["saved"];
    const { generation } = await admitPrepared(preparedTurn({ assistantId, topicId }), actor);
    const entry = await ensureGenerationRunning(generation.id);

    const reader = subscribeToGeneration(entry!).getReader();
    const chunks: ChatChunk[] = [];
    let outcomeWhenFinishArrived: string | null | undefined;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
      if (value.type === "finish") {
        const rows = await db
          .select({ outcome: chatMessages.outcome })
          .from(chatMessages)
          .where(eq(chatMessages.id, generation.assistantMessageId!));
        outcomeWhenFinishArrived = rows[0]?.outcome;
      }
    }

    // The finish chunk is the client's "done" signal: by then the terminal
    // transaction must already be committed, otherwise a failed save would
    // look like a completed answer.
    expect(outcomeWhenFinishArrived).toBe("completed");
    expect(chunks.some((chunk) => chunk.type === "finish")).toBe(true);
    expect(
      chunks.some((chunk) => chunk.type === "text-delta" && chunk.delta === "saved"),
    ).toBe(true);
  });

  it("stops a running turn, keeps the partial answer and aborts the provider", async () => {
    const { actor, assistantId, topicId } = await seedChat(provider.baseUrl);
    provider.deltas = ["partial"];
    provider.deltaDelayMs = 40;
    provider.holdOpen = true;
    const { generation } = await admitPrepared(preparedTurn({ assistantId, topicId }), actor);
    const entry = await ensureGenerationRunning(generation.id);
    if (!entry) throw new Error("missing live generation");

    await readUntilText(subscribeToGeneration(entry).getReader(), "partial");
    await stopGenerationById(generation.id, actor);
    await entry.settled;

    expect((await generationRow(generation.id))?.status).toBe("stopped");
    const messages = await listTopicMessages({ topicId }, actor);
    expect(messages.find((message) => message.role === "assistant")?.metadata?.outcome).toBe(
      "stopped",
    );
    expect(await assistantText(topicId, actor)).toContain("partial");
    expect(provider.aborted).toBe(1);
    expect(getLiveGeneration(generation.id)).toBeUndefined();
    expect(provider.calls).toHaveLength(1);
  });

  it("stops a queued turn without ever reaching the model", async () => {
    const { actor, assistantId, topicId } = await seedChat(provider.baseUrl);
    const { generation } = await admitPrepared(preparedTurn({ assistantId, topicId }), actor);

    await stopGenerationById(generation.id, actor);

    expect(provider.calls).toHaveLength(0);
    expect((await generationRow(generation.id))?.status).toBe("stopped");
    const messages = await listTopicMessages({ topicId }, actor);
    const answer = messages.find((message) => message.role === "assistant");
    // The placeholder is settled: history cannot keep an empty row that looks
    // like it is still generating.
    expect(answer?.metadata?.outcome).toBe("stopped");
    expect(answer?.parts).toEqual([]);
  });

  it("drops a deleted topic's live content and closes its subscribers", async () => {
    const { actor, assistantId, topicId } = await seedChat(provider.baseUrl);
    provider.deltas = ["keep?", "late"];
    provider.deltaDelayMs = 600;
    provider.holdOpen = true;
    const { generation } = await admitPrepared(preparedTurn({ assistantId, topicId }), actor);
    const entry = await ensureGenerationRunning(generation.id);
    if (!entry) throw new Error("missing live generation");

    const reader = subscribeToGeneration(entry).getReader();
    const delivered = await readUntilText(reader, "keep?");

    await deleteTopic(topicId, actor);
    // The already-authorized connection is closed, and the chunk produced after
    // the delete is never delivered.
    delivered.push(...(await drainStream(reader)));
    await entry.settled;

    expect(
      delivered.some(
        (chunk) => chunk.type === "text-delta" && chunk.delta.includes("late"),
      ),
    ).toBe(false);
    expect(entry.discarded).toBe(true);
    // A deleted topic must not keep its answer in memory for a late resume.
    expect(entry.state.message.parts).toEqual([]);
    expect((await generationRow(generation.id))?.status).toBe("stopped");
    expect(
      await db.select().from(chatMessages).where(eq(chatMessages.topicId, topicId)),
    ).toHaveLength(0);
    // The upstream request is really severed, not just ignored (the socket
    // close can land a tick after the abort).
    await waitFor(() => provider.aborted === 1);
  });

  it("boots once, closes leftover turns before accepting work and picks up queued rows", async () => {
    const { actor, assistantId, topicId } = await seedChat(provider.baseUrl);
    // A turn the previous process claimed and never finished.
    const { generation: leftover } = await admitPrepared(
      preparedTurn({ assistantId, topicId, userMessageId: "u-leftover" }),
      actor,
    );
    await claimGeneration(leftover.id);
    await checkpointGeneration({
      topicId,
      messageId: leftover.assistantMessageId!,
      parts: [{ type: "text", text: "saved before crash" }],
    });
    // One topic may only have one active turn, so each case gets its own.
    const stoppingTopic = await createTopicForChat({ assistantId }, actor, "New topic");
    const { generation: stopping } = await admitPrepared(
      preparedTurn({ assistantId, topicId: stoppingTopic.id, userMessageId: "u-stopping" }),
      actor,
    );
    await markGenerationStopping(stopping.id, actor);
    const queuedTopic = await createTopicForChat({ assistantId }, actor, "New topic");
    const { generation: queued } = await admitPrepared(
      preparedTurn({ assistantId, topicId: queuedTopic.id, userMessageId: "u-queued" }),
      actor,
    );
    provider.deltas = ["after boot"];

    // Concurrent starters share one boot: a second recovery sweep would
    // interrupt rows the first sweep already handed to fresh turns.
    const boot = startGenerationRunner();
    expect(startGenerationRunner()).toBe(boot);
    await boot;

    // Boot recovery ran first: the leftover turn is closed, not re-run, and
    // keeps the content the previous process already saved.
    expect((await generationRow(leftover.id))?.status).toBe("interrupted");
    const recoveredAnswer = (await listTopicMessages({ topicId }, actor)).find(
      (message) => message.id === leftover.assistantMessageId,
    );
    expect(recoveredAnswer?.parts).toEqual([{ type: "text", text: "saved before crash" }]);
    expect(recoveredAnswer?.metadata?.outcome).toBe("failed");
    expect(recoveredAnswer?.metadata?.errorMessage).toContain("interrupted");
    expect((await generationRow(stopping.id))?.status).toBe("stopped");
    const stoppedAnswer = (await listTopicMessages({ topicId: stoppingTopic.id }, actor)).find(
      (message) => message.role === "assistant",
    );
    expect(stoppedAnswer?.metadata?.outcome).toBe("stopped");
    expect(stoppedAnswer?.metadata?.errorMessage).toBeUndefined();

    // The queued row is claimed by the boot sweep and completes, and the
    // provider was called exactly once (for the queued turn, not the leftover).
    await waitFor(async () => (await generationRow(queued.id))?.status === "completed");
    expect(provider.calls).toHaveLength(1);
  });

  it("settles a stop that races the claim without leaving a live turn", async () => {
    const { actor, assistantId, topicId } = await seedChat(provider.baseUrl);
    provider.deltas = ["racy"];
    provider.deltaDelayMs = 200;
    provider.holdOpen = true;
    const { generation } = await admitPrepared(preparedTurn({ assistantId, topicId }), actor);

    const [entry] = await Promise.all([
      ensureGenerationRunning(generation.id),
      stopGenerationById(generation.id, actor),
    ]);
    if (entry) {
      // The claim won the race: the entry it produced must be aborted rather
      // than left generating (the old code returned without aborting it).
      await entry.settled;
    } else {
      // The stop committed first: claim only wins from `queued`, so no entry
      // was created and the model is never called.
      expect(provider.calls).toHaveLength(0);
    }

    // Either ordering ends in the same durable state: stopped, placeholder
    // settled, nothing left running.
    expect((await generationRow(generation.id))?.status).toBe("stopped");
    expect(getLiveGeneration(generation.id)).toBeUndefined();
    const messages = await listTopicMessages({ topicId }, actor);
    expect(
      messages.find((message) => message.role === "assistant")?.metadata?.outcome,
    ).toBe("stopped");
    // A racing stop may reach the provider before the abort arrives, but never
    // more than once, and no call outlives the turn.
    expect(provider.calls.length).toBeLessThanOrEqual(1);
    expect(provider.aborted).toBeLessThanOrEqual(provider.calls.length);
  });

  it("cancels post-turn side effects when the topic is deleted", async () => {
    const { actor, topicId } = await seedChat(provider.baseUrl);
    let aborted = false;
    const done = runPostTurnTask(
      topicId,
      (signal) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 5_000);
          timer.unref?.();
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve();
          });
        }),
    );

    await deleteTopic(topicId, actor);
    await done;

    // Title naming (and, in the next phase, search cleanup) must not keep
    // working on a topic the user already deleted.
    expect(aborted).toBe(true);
  });

  it("waits for the real in-flight checkpoint before starting terminal persistence", async () => {
    const { actor, assistantId, topicId } = await seedChat(provider.baseUrl);
    provider.deltas = ["checkpoint before stop"];
    provider.holdOpen = true;
    const { generation } = await admitPrepared(preparedTurn({ assistantId, topicId }), actor);
    const entry = await ensureGenerationRunning(generation.id);
    if (!entry) throw new Error("missing live generation");
    await readUntilText(subscribeToGeneration(entry).getReader(), "checkpoint");
    const locked = Promise.withResolvers<number>();
    const release = Promise.withResolvers<void>();
    const blocker = db.transaction(async tx => {
      await tx.select().from(chatMessages).where(eq(chatMessages.id, generation.assistantMessageId!)).for("update");
      const [backend] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      locked.resolve(backend!.pid);
      await release.promise;
    });
    const pid = await locked.promise;
    // Observe the I/O boundary without replacing it; checkpoint is a single
    // UPDATE while finalization opens a transaction. The real 10s timer runs.
    const transactions = vi.spyOn(db, "transaction");
    try {
      await waitUntilBlocking(pid, 15_000);
      await stopGenerationById(generation.id, actor);
      await waitFor(() => entry.pendingTerminal !== null);
      expect(transactions).not.toHaveBeenCalled();
    } finally {
      release.resolve();
      await blocker;
      transactions.mockRestore();
    }
    await entry.settled;
    expect((await generationRow(generation.id))?.status).toBe("stopped");
    expect(await assistantText(topicId, actor)).toBe("checkpoint before stop");
    const messages = await listTopicMessages({ topicId }, actor);
    expect(messages.find(message => message.role === "assistant")?.metadata?.outcome).toBe("stopped");
    expect(provider.calls).toHaveLength(1);
  });

  it("carries usage/reasoning metadata into the crash-retention checkpoint and filters markup in tool mode only", () => {
    const state = createLiveStreamState({
      generationId: "gen",
      userId: "user",
      topicId: "topic",
      assistantMessageId: "answer",
    });
    applyChunk(state, { type: "start", messageId: "answer" });
    applyChunk(state, { type: "start-step" });
    applyChunk(state, { type: "text-start", id: "t1" });
    applyChunk(state, { type: "text-delta", id: "t1", delta: "par<tool_call>leaked</tool_call>" });
    applyChunk(state, {
      type: "message-metadata",
      messageMetadata: {
        reasoningMs: 1_234,
        totalTokens: 7,
        finishReason: "length",
      },
    });

    // Framing parts never persist, and the feedback the answer already earned
    // survives a crash instead of only its text.
    expect(checkpointContentOf(state)).toEqual({
      parts: [{ type: "text", text: "par<tool_call>leaked</tool_call>" }],
      reasoningMs: 1_234,
      totalTokens: 7,
      finishReason: "length",
    });
    // The persistence markup safety net applies to tool-mode turns only.
    expect(checkpointContentOf(state, true).parts).toEqual([{ type: "text", text: "par" }]);
  });

  it.each(["topic", "assistant"] as const)("cleans an image committed while %s deletion waits for the topic lock", async (target) => {
    const { actor, assistantId, topicId } = await seedChat(provider.baseUrl);
    await createAssistant({ name: "Spare", icon: "✨" }, actor);
    const { generation } = await admitPrepared(preparedTurn({ assistantId, topicId }), actor);
    await claimGeneration(generation.id);
    const uploaded = await uploadFile(
      {
        filename: "generated.png",
        mediaType: "image/png",
        data: Buffer.from([1, 2, 3]),
      },
      actor,
      { skipSizeLimit: true },
    );

    // Hold the parent lock the way a finalize does, then let the delete start:
    // it must see the parts committed in between, otherwise the image this
    // turn produced leaks (the old code read parts before taking the lock).
    const locked = Promise.withResolvers<number>();
    const release = Promise.withResolvers<void>();
    const finalizeLike = db.transaction(async (tx) => {
      await tx
        .select({ id: topics.id })
        .from(topics)
        .where(eq(topics.id, topicId))
        .for("update");
      const [backend] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      locked.resolve(backend!.pid);
      await release.promise;
      await writeAssistantTurnRow(tx, {
        topicId,
        messageId: generation.assistantMessageId!,
        parts: [
          {
            type: "file",
            url: uploaded.url,
            mediaType: uploaded.mediaType,
            filename: uploaded.filename,
          },
          { type: "text", text: "here it is" },
        ],
        outcome: "completed",
      });
      await tx
        .update(chatGenerations)
        .set({ status: "completed", finishedAt: new Date() })
        .where(eq(chatGenerations.id, generation.id));
    });

    const pid = await locked.promise;
    const deletion = target === "topic"
      ? deleteTopic(topicId, actor)
      : deleteAssistant(assistantId, actor);
    // Do not race a sleep: observe the deleter actually waiting on this
    // transaction before finalizing. Taking generation before topic would
    // now deadlock, and reading file references before topic would leak.
    try {
      await waitUntilBlocking(pid);
    } finally {
      release.resolve();
    }
    await Promise.all([finalizeLike, deletion]);

    expect(
      await db.select({ id: files.id }).from(files).where(eq(files.id, uploaded.id)),
    ).toEqual([]);
    await expect(
      getFileStorage().get(`${actor.userId}/${uploaded.id}.png`),
    ).rejects.toThrow();
  });
});
