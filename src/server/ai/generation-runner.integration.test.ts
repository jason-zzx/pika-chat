import "server-only";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { requireActor } from "@/server/auth/actor";
import {
  adminCredentials,
  authPost,
  cookiesFrom,
  jsonRequest,
  postSetup,
  userCredentials,
} from "@/server/auth/auth-test-helpers";
import {
  checkpointContentOf,
  ensureGenerationRunning,
  runPostTurnTask,
  resetGenerationRunnerForTests,
  startGenerationRunner,
  stopGenerationById,
  stopGenerationRunner,
  subscribeToGeneration,
} from "@/server/ai/generation-runner";
import {
  applyChunk,
  createLiveStreamState,
  type ChatChunk,
} from "@/server/ai/generation-stream";
import {
  getLiveGeneration,
  resetLiveGenerations,
  type LiveGeneration,
} from "@/server/ai/generation-registry";
import { getDb } from "@/server/db/client";
import {
  APP_SETTINGS_ROW_ID,
  accounts,
  appSettings,
  assistants,
  chatGenerations,
  chatMessages,
  files,
  providerConfigs,
  providerModels,
  sessions,
  topics,
  users,
  verifications,
} from "@/server/db/schema";
import { getFileStorage } from "@/server/files/storage";
import { uploadFile } from "@/server/files/file.service";
import { createAssistant, deleteAssistant } from "@/server/services/assistant.service";
import {
  admitTurn,
  claimGeneration,
  checkpointGeneration,
  type GenerationRow,
  type PreparedTurn,
} from "@/server/services/generation.service";
import {
  listTopicMessages,
  writeAssistantTurnRow,
} from "@/server/services/message.service";
import { createTopicForChat, deleteTopic } from "@/server/services/topic.service";

/**
 * Real executor behaviour (chat task §3/§5/R8/R9).
 *
 * These tests run the actual producer against a local OpenAI-compatible HTTP
 * endpoint (no paid provider, no mocking of the turn/runner): what is asserted
 * is that the server — not a browser request — completes, saves and closes a
 * turn, and what happens to the in-memory content, the subscriptions and the
 * provider connection when the topic is deleted, the user stops the answer or
 * the process shuts down.
 */

const db = getDb();

type ProviderScript = {
  /** Text deltas the endpoint streams. */
  deltas: string[];
  /** Delay before each delta, so a test can observe the mid-answer state. */
  deltaDelayMs?: number;
  /** Keep the response open after the deltas until the client goes away. */
  holdOpen?: boolean;
};

let script: ProviderScript = { deltas: ["Hello"] };
let requestCount = 0;
let finishedResponses = 0;
let abortedResponses = 0;
let server: Server;
let baseUrl = "";

function chunkLine(delta: Record<string, unknown>, finishReason: string | null): string {
  return `data: ${JSON.stringify({
    id: "cmpl-test",
    object: "chat.completion.chunk",
    created: 1,
    model: "gpt-4o",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeAll(async () => {
  server = createServer((request, response) => {
    requestCount += 1;
    request.resume();
    request.on("end", () => {
      void (async () => {
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        const current = script;
        for (const delta of current.deltas) {
          if (response.destroyed) {
            return;
          }
          response.write(chunkLine({ content: delta }, null));
          if (current.deltaDelayMs) {
            await sleep(current.deltaDelayMs);
          }
        }
        if (current.holdOpen) {
          // Stay in the middle of an answer until the client disconnects.
          await new Promise<void>((resolve) => {
            response.once("close", () => resolve());
          });
          return;
        }
        response.write(chunkLine({}, "stop"));
        response.write("data: [DONE]\n\n");
        response.end();
        finishedResponses += 1;
      })();
    });
    response.on("close", () => {
      if (!response.writableEnded) {
        abortedResponses += 1;
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  script = { deltas: ["Hello"] };
  requestCount = 0;
  finishedResponses = 0;
  abortedResponses = 0;
});

type Actor = Awaited<ReturnType<typeof requireActor>>;

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

/** One user with an assistant, a topic and a local provider/model row. */
async function seedChat(): Promise<{
  actor: Actor;
  assistantId: string;
  topicId: string;
}> {
  await resetState();
  const setup = await postSetup(
    jsonRequest("/api/setup", { body: adminCredentials }),
  );
  expect(setup.status).toBe(201);
  const superCookie = cookiesFrom(setup);
  const created = await authPost(
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
  expect(created.status).toBe(200);
  const cookie = await signIn(userCredentials.email, userCredentials.password);
  const actor = await requireActor(jsonRequest("/api/topics", { cookie }).headers);

  await db.insert(providerConfigs).values({
    id: "cfg-runner",
    ownerId: actor.userId,
    name: "Local",
    baseUrl,
  });
  await db.insert(providerModels).values({
    id: "pm-runner",
    providerConfigId: "cfg-runner",
    modelId: "gpt-4o",
  });
  const assistant = await createAssistant({ name: "Owner", icon: "✨" }, actor);
  const topic = await createTopicForChat(
    { assistantId: assistant.id },
    actor,
    "New topic",
  );
  return { actor, assistantId: assistant.id, topicId: topic.id };
}

function prepared(input: {
  assistantId: string;
  topicId: string;
  userMessageId: string;
  historyMessageIds?: string[];
  titleCandidate?: boolean;
}): PreparedTurn {
  return {
    kind: "send",
    assistantId: input.assistantId,
    topicId: input.topicId,
    providerConfigId: "cfg-runner",
    modelId: "gpt-4o",
    historyMessageIds: input.historyMessageIds ?? [],
    userMessage: {
      message: {
        id: input.userMessageId,
        role: "user",
        parts: [{ type: "text", text: "hello" }],
      },
      // The prepared message carries resolved file parts alongside; the turn
      // only needs the model-facing text here.
    } as unknown as PreparedTurn["userMessage"],
    defaultTopicTitle: "New topic",
    // Titles are a separate (later) phase; keep the turn focused on lifecycle.
    titleCandidate: input.titleCandidate ?? false,
    actorRole: "user",
    requestHash: `hash-${input.userMessageId}`,
  };
}

async function admit(
  actor: Actor,
  input: { assistantId: string; topicId: string; userMessageId?: string },
): Promise<GenerationRow> {
  const turn = prepared({
    assistantId: input.assistantId,
    topicId: input.topicId,
    userMessageId: input.userMessageId ?? `u-${Date.now()}`,
  });
  const { generation } = await admitTurn(
    { requestHash: turn.requestHash },
    async () => turn,
    actor,
  );
  return generation;
}

async function generationRow(id: string): Promise<GenerationRow | undefined> {
  const rows = await db
    .select()
    .from(chatGenerations)
    .where(eq(chatGenerations.id, id));
  return rows[0];
}

async function waitFor<T>(
  check: () => Promise<T | null | false | undefined> | T | null | false | undefined,
  timeoutMs = 8_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for condition");
    }
    await sleep(20);
  }
}

/**
 * Attaches a client and reads until a text delta containing `marker` arrives —
 * the observable "the answer is streaming" point, without waiting for the
 * checkpoint cadence (the DB is not the live path).
 */
async function readUntilText(
  entry: LiveGeneration,
  marker: string,
): Promise<ChatChunk[]> {
  const reader = subscribeToGeneration(entry).getReader();
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

async function drainStream(
  reader: ReadableStreamDefaultReader<ChatChunk>,
): Promise<ChatChunk[]> {
  const seen: ChatChunk[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return seen;
    }
    seen.push(value);
  }
}

async function assistantText(topicId: string, actor: Actor): Promise<string> {
  const messages = await listTopicMessages({ topicId }, actor);
  const answer = messages.find((message) => message.role === "assistant");
  return (answer?.parts ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

beforeEach(async () => {
  resetGenerationRunnerForTests();
  resetLiveGenerations();
});

afterEach(async () => {
  await stopGenerationRunner();
  resetGenerationRunnerForTests();
  resetLiveGenerations();
});

describe("generation executor", () => {
  it("completes a turn with no browser attached and stores the answer once", async () => {
    const { actor, assistantId, topicId } = await seedChat();
    script = { deltas: ["Hel", "lo"] };
    const generation = await admit(actor, { assistantId, topicId });

    await ensureGenerationRunning(generation.id);
    await waitFor(async () => (await generationRow(generation.id))?.status === "completed");

    // One provider call, one stored answer — no subscription involved.
    expect(requestCount).toBe(1);
    expect(finishedResponses).toBe(1);
    expect(await assistantText(topicId, actor)).toBe("Hello");
    const messages = await listTopicMessages({ topicId }, actor);
    const answer = messages.find((message) => message.role === "assistant");
    expect(answer?.id).toBe(generation.assistantMessageId);
    expect(answer?.metadata?.outcome).toBe("completed");
    expect(answer?.metadata?.modelId).toBe("gpt-4o");
    expect(getLiveGeneration(generation.id)).toBeUndefined();
  });

  it("only ends the subscription when the browser goes away, and keeps slow subscribers isolated", async () => {
    const { actor, assistantId, topicId } = await seedChat();
    script = { deltas: ["part one ", "part two"], deltaDelayMs: 150 };
    const generation = await admit(actor, { assistantId, topicId });
    const entry = await ensureGenerationRunning(generation.id);
    if (!entry) throw new Error("missing live generation");

    const subscription = subscribeToGeneration(entry);
    const reader = subscription.getReader();
    expect(entry.subscribers.size).toBe(1);
    // Read the first chunk, then walk away like a closed tab would.
    const first = await reader.read();
    expect(first.done).toBe(false);
    await reader.cancel();
    expect(entry.subscribers.size).toBe(0);
    expect(entry.controller.signal.aborted).toBe(false);

    await waitFor(async () => (await generationRow(generation.id))?.status === "completed");
    expect(requestCount).toBe(1);
    expect(abortedResponses).toBe(0);
    expect(await assistantText(topicId, actor)).toBe("part one part two");
  });

  it("evicts a slow subscriber without cancelling the generation or stalling a healthy subscriber", async () => {
    const { actor, assistantId, topicId } = await seedChat();
    const deltas = Array.from({ length: 1200 }, (_, i) => `c${i}-`);
    script = { deltas };
    const generation = await admit(actor, { assistantId, topicId });
    const entry = await ensureGenerationRunning(generation.id);
    expect(entry).not.toBeNull();

    // Unread subscriber: opens the stream and never reads from it.
    const slowSub = subscribeToGeneration(entry!);
    // Healthy subscriber: drains every chunk as it arrives.
    const healthySub = subscribeToGeneration(entry!);
    const healthyChunks = await drainStream(healthySub.getReader());

    await waitFor(async () => (await generationRow(generation.id))?.status === "completed");
    expect(healthyChunks.some((chunk) => chunk.type === "finish")).toBe(true);
    expect(await assistantText(topicId, actor)).toBe(deltas.join(""));
    const slowChunks = await drainStream(slowSub.getReader());
    expect(slowChunks.length).toBeLessThan(healthyChunks.length);
    expect(slowChunks.some((chunk) => chunk.type === "finish")).toBe(false);
    expect(requestCount).toBe(1);
    expect(abortedResponses).toBe(0);
  });

  it("does not call the model twice for duplicate wake-ups", async () => {
    const { actor, assistantId, topicId } = await seedChat();
    script = { deltas: ["once"], deltaDelayMs: 100 };
    const generation = await admit(actor, { assistantId, topicId });

    const [first, second] = await Promise.all([
      ensureGenerationRunning(generation.id),
      ensureGenerationRunning(generation.id),
    ]);
    expect(first).toBe(second);
    // A later sweep/tick finding the same live turn must reuse it as well.
    expect(await ensureGenerationRunning(generation.id)).toBe(first);

    await waitFor(async () => (await generationRow(generation.id))?.status === "completed");
    expect(requestCount).toBe(1);
    expect(await assistantText(topicId, actor)).toBe("once");
  });

  it("tells subscribers the answer finished only after it is saved", async () => {
    const { actor, assistantId, topicId } = await seedChat();
    script = { deltas: ["saved"] };
    const generation = await admit(actor, { assistantId, topicId });
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
    const { actor, assistantId, topicId } = await seedChat();
    script = { deltas: ["partial"], deltaDelayMs: 40, holdOpen: true };
    const generation = await admit(actor, { assistantId, topicId });
    const entry = await ensureGenerationRunning(generation.id);
    expect(entry).not.toBeNull();

    await readUntilText(entry!, "partial");
    await stopGenerationById(generation.id, actor);
    await entry!.settled;

    const row = await generationRow(generation.id);
    expect(row?.status).toBe("stopped");
    const messages = await listTopicMessages({ topicId }, actor);
    const answer = messages.find((message) => message.role === "assistant");
    expect(answer?.metadata?.outcome).toBe("stopped");
    expect(
      (answer?.parts ?? [])
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(""),
    ).toContain("partial");
    expect(abortedResponses).toBe(1);
    expect(getLiveGeneration(generation.id)).toBeUndefined();
    expect(requestCount).toBe(1);
  });

  it("stops a queued turn without ever reaching the model", async () => {
    const { actor, assistantId, topicId } = await seedChat();
    const generation = await admit(actor, { assistantId, topicId });

    await stopGenerationById(generation.id, actor);

    expect(requestCount).toBe(0);
    expect((await generationRow(generation.id))?.status).toBe("stopped");
    const messages = await listTopicMessages({ topicId }, actor);
    const answer = messages.find((message) => message.role === "assistant");
    // The placeholder is settled: history cannot keep an empty row that looks
    // like it is still generating.
    expect(answer?.metadata?.outcome).toBe("stopped");
    expect(answer?.parts).toEqual([]);
  });

  it("drops a deleted topic's live content and closes its subscribers", async () => {
    const { actor, assistantId, topicId } = await seedChat();
    script = { deltas: ["keep?", "late"], deltaDelayMs: 600, holdOpen: true };
    const generation = await admit(actor, { assistantId, topicId });
    const entry = await ensureGenerationRunning(generation.id);
    expect(entry).not.toBeNull();

    const reader = subscribeToGeneration(entry!).getReader();
    const delivered: ChatChunk[] = [];
    // Read just far enough to know the answer is streaming to the client.
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        throw new Error("stream ended before the answer started");
      }
      delivered.push(value);
      if (value.type === "text-delta" && value.delta.includes("keep?")) {
        break;
      }
    }

    await deleteTopic(topicId, actor);
    // The already-authorized connection is closed, and the chunk produced after
    // the delete is never delivered.
    delivered.push(...(await drainStream(reader)));
    await entry!.settled;

    expect(
      delivered.some(
        (chunk) => chunk.type === "text-delta" && chunk.delta.includes("late"),
      ),
    ).toBe(false);
    expect(entry!.discarded).toBe(true);
    expect((await generationRow(generation.id))?.status).toBe("stopped");
    expect(
      await db.select().from(chatMessages).where(eq(chatMessages.topicId, topicId)),
    ).toHaveLength(0);
    // The upstream request is really severed, not just ignored (the socket
    // close can land a tick after the abort).
    await waitFor(() => abortedResponses === 1);
  });

  it("closes leftover turns before accepting work and picks up queued rows", async () => {
    const { actor, assistantId, topicId } = await seedChat();
    // A turn the previous process claimed and never finished.
    const leftover = await admit(actor, {
      assistantId,
      topicId,
      userMessageId: "u-leftover",
    });
    await claimGeneration(leftover.id);
    await checkpointGeneration({
      topicId,
      messageId: leftover.assistantMessageId!,
      parts: [{ type: "text", text: "saved before crash" }],
    });
    // A second topic: one topic may only have one active turn.
    const queuedTopic = await createTopicForChat(
      { assistantId },
      actor,
      "New topic",
    );
    const queued = await admit(actor, {
      assistantId,
      topicId: queuedTopic.id,
      userMessageId: "u-queued",
    });
    script = { deltas: ["after boot"] };

    await startGenerationRunner();

    // Boot recovery ran first: the leftover turn is closed, not re-run.
    const recovered = await generationRow(leftover.id);
    expect(recovered?.status).toBe("interrupted");
    const recoveredMessages = await listTopicMessages({ topicId }, actor);
    const recoveredAnswer = recoveredMessages.find(
      (message) => message.id === leftover.assistantMessageId,
    );
    expect(recoveredAnswer?.metadata?.outcome).toBe("failed");
    expect(recoveredAnswer?.metadata?.errorMessage).toContain("interrupted");

    // The queued row is claimed by the boot sweep and completes, and the
    // provider was called exactly once (for the queued turn, not the leftover).
    await waitFor(async () => (await generationRow(queued.id))?.status === "completed");
    expect(requestCount).toBe(1);
  });

  it("stops accepting new work on explicit stopGenerationRunner and persists partial answers", async () => {
    // Tests explicit stopGenerationRunner() behavior directly (framework signal
    // interception was removed per design §10.3; production exits rely on
    // checkpoints and boot recovery).
    const { actor, assistantId, topicId } = await seedChat();
    script = { deltas: ["shutdown partial"], deltaDelayMs: 40, holdOpen: true };
    await startGenerationRunner();
    const generation = await admit(actor, { assistantId, topicId });
    const entry = await ensureGenerationRunning(generation.id);
    expect(entry).not.toBeNull();
    await readUntilText(entry!, "shutdown");

    await stopGenerationRunner();

    // The partial answer is on disk before the process would exit…
    const row = await generationRow(generation.id);
    expect(row?.status).toBe("stopped");
    expect(await assistantText(topicId, actor)).toContain("shutdown partial");
    expect(abortedResponses).toBe(1);
    // …and nothing new is claimed by a process that is going away.
    expect(await ensureGenerationRunning(generation.id)).toBeNull();
  });

  it("waits for a claim that is still starting before the shutdown returns", async () => {
    const { actor, assistantId, topicId } = await seedChat();
    script = { deltas: ["never"], holdOpen: true };
    const generation = await admit(actor, { assistantId, topicId });

    // Hold the task row so the claim (queued → running) is genuinely in flight
    // and the entry is not registered as live yet: exactly the window a
    // shutdown must not walk past, because only this process can finish it.
    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const blocker = db.transaction(async (tx) => {
      await tx
        .select()
        .from(chatGenerations)
        .where(eq(chatGenerations.id, generation.id))
        .for("update");
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    try {
      const claiming = ensureGenerationRunning(generation.id);
      const shutdown = stopGenerationRunner();

      // The shutdown is waiting on that claim instead of reporting success.
      const early = await Promise.race([
        shutdown.then(() => "returned" as const),
        sleep(150).then(() => "waiting" as const),
      ]);
      expect(early).toBe("waiting");

      release.resolve();
      await blocker;
      const entry = await claiming;
      await shutdown;

      // The claim completed after shutdown began, so its turn is aborted before
      // the model is called and closed from its empty state.
      expect(entry).not.toBeNull();
      expect(requestCount).toBe(0);
      expect((await generationRow(generation.id))?.status).toBe("stopped");
      expect(getLiveGeneration(generation.id)).toBeUndefined();
      expect(await ensureGenerationRunning(generation.id)).toBeNull();
    } finally {
      release.resolve();
      await blocker;
    }
  });

  it("saves live turns without waiting behind a blocked claim during shutdown", async () => {
    const { actor, assistantId, topicId } = await seedChat();
    script = { deltas: ["save while claim waits"], holdOpen: true };
    const running = await admit(actor, { assistantId, topicId });
    const live = await ensureGenerationRunning(running.id);
    if (!live) throw new Error("missing live generation");
    await readUntilText(live, "save while");
    const other = await createTopicForChat({ assistantId }, actor, "New topic");
    const queued = await admit(actor, { assistantId, topicId: other.id });
    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const blocker = db.transaction(async tx => {
      await tx.select().from(chatGenerations).where(eq(chatGenerations.id, queued.id)).for("update");
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    const claiming = ensureGenerationRunning(queued.id);
    const shutdown = stopGenerationRunner();
    try {
      expect(await Promise.race([
        live.settled.then(() => true), sleep(1000).then(() => false),
      ])).toBe(true);
      expect((await generationRow(running.id))?.status).toBe("stopped");
      expect(await assistantText(topicId, actor)).toBe("save while claim waits");
    } finally {
      release.resolve();
      await blocker;
      await claiming;
      await shutdown;
    }
    expect((await generationRow(queued.id))?.status).toBe("stopped");
    expect(requestCount).toBe(1);
  });

  it("serves repeated shutdown calls from the same in-flight save", async () => {
    const { actor, assistantId, topicId } = await seedChat();
    script = { deltas: ["shared shutdown"], deltaDelayMs: 20, holdOpen: true };
    const generation = await admit(actor, { assistantId, topicId });
    const entry = await ensureGenerationRunning(generation.id);
    expect(entry).not.toBeNull();
    await readUntilText(entry!, "shared");

    // Hold the topic lock so the terminal save of the aborted turn cannot
    // complete; the shutdown has to stay pending.
    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const blocker = db.transaction(async (tx) => {
      await tx.select().from(topics).where(eq(topics.id, topicId)).for("update");
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    try {
      const first = stopGenerationRunner();
      const second = stopGenerationRunner();
      // Same work, not a second earlier-returning "already stopping" path.
      expect(second).toBe(first);

      const early = await Promise.race([
        first.then(() => "returned" as const),
        sleep(150).then(() => "waiting" as const),
      ]);
      expect(early).toBe("waiting");

      release.resolve();
      await blocker;
      await first;

      expect((await generationRow(generation.id))?.status).toBe("stopped");
      expect(await assistantText(topicId, actor)).toContain("shared shutdown");
      expect(getLiveGeneration(generation.id)).toBeUndefined();
      // A later call has nothing left to do and resolves at once.
      await expect(stopGenerationRunner()).resolves.toBeUndefined();
    } finally {
      release.resolve();
      await blocker;
    }
  });

  it("settles a stop that races the claim without leaving a live turn", async () => {
    const { actor, assistantId, topicId } = await seedChat();
    script = { deltas: ["racy"], deltaDelayMs: 200, holdOpen: true };
    const generation = await admit(actor, { assistantId, topicId });

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
      expect(requestCount).toBe(0);
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
    expect(requestCount).toBeLessThanOrEqual(1);
    expect(abortedResponses).toBeLessThanOrEqual(requestCount);
  });

  it("cancels post-turn side effects when the topic is deleted", async () => {
    const { actor, topicId } = await seedChat();
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

  it("boots once: concurrent starters share one recovery", async () => {
    const { actor, assistantId, topicId } = await seedChat();
    const leftover = await admit(actor, { assistantId, topicId });
    await claimGeneration(leftover.id);

    const [first, second] = await Promise.all([
      startGenerationRunner(),
      startGenerationRunner(),
    ]);
    expect(first).toBe(second);
    // One boot closed the leftover row; a second boot would have had nothing
    // to recover and would have started a second sweep.
    expect((await generationRow(leftover.id))?.status).toBe("interrupted");
  });

  it("keeps the persistence markup safety net on tool-mode turns only", () => {
    const state = createLiveStreamState({
      generationId: "g", userId: "u", topicId: "t", assistantMessageId: "a",
    });
    applyChunk(state, { type: "text-start", id: "text" });
    applyChunk(state, { type: "text-delta", id: "text", delta: "answer<tool_call>leaked</tool_call>" });
    expect(checkpointContentOf(state, true).parts).toMatchObject([
      { type: "text", text: "answer" },
    ]);
    expect(checkpointContentOf(state).parts).toMatchObject([
      { type: "text", text: "answer<tool_call>leaked</tool_call>" },
    ]);
  });

  it("waits for the real in-flight checkpoint before starting terminal persistence", async () => {
    const { actor, assistantId, topicId } = await seedChat();
    script = { deltas: ["checkpoint before stop"], holdOpen: true };
    const generation = await admit(actor, { assistantId, topicId });
    const entry = await ensureGenerationRunning(generation.id);
    if (!entry) throw new Error("missing live generation");
    await readUntilText(entry, "checkpoint");
    const messageId = generation.assistantMessageId;
    if (!messageId) throw new Error("missing assistant message");
    const locked = Promise.withResolvers<number>();
    const release = Promise.withResolvers<void>();
    const blocker = db.transaction(async tx => {
      await tx.select().from(chatMessages).where(eq(chatMessages.id, messageId)).for("update");
      const [backend] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      if (!backend) throw new Error("missing backend pid");
      locked.resolve(backend.pid);
      await release.promise;
    });
    const pid = await locked.promise;
    // Observe the I/O boundary without replacing it; checkpoint is a single
    // UPDATE while finalization opens a transaction. The real 10s timer runs.
    const transactions = vi.spyOn(db, "transaction");
    try {
      await waitFor(async () => {
        const [blocked] = await db.execute<{ count: number }>(sql`
          select count(*)::int as count from pg_stat_activity
          where ${pid} = ANY(pg_blocking_pids(pid))
        `);
        return (blocked?.count ?? 0) > 0;
      }, 15_000);
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
    expect(requestCount).toBe(1);
  });

  it("carries usage/reasoning metadata into the crash-retention checkpoint", () => {
    const state = createLiveStreamState({
      generationId: "gen",
      userId: "user",
      topicId: "topic",
      assistantMessageId: "answer",
    });
    applyChunk(state, { type: "start", messageId: "answer" });
    applyChunk(state, { type: "start-step" });
    applyChunk(state, { type: "text-start", id: "t1" });
    applyChunk(state, { type: "text-delta", id: "t1", delta: "par" });
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
      parts: [{ type: "text", text: "par" }],
      reasoningMs: 1_234,
      totalTokens: 7,
      finishReason: "length",
    });
  });

  it.each(["topic", "assistant"] as const)("cleans an image committed while %s deletion waits for the topic lock", async (target) => {
    const { actor, assistantId, topicId } = await seedChat();
    await createAssistant({ name: "Spare", icon: "✨" }, actor);
    const generation = await admit(actor, { assistantId, topicId });
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
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = Promise.withResolvers<number>();
    const finalizeLike = db.transaction(async (tx) => {
      await tx
        .select({ id: topics.id })
        .from(topics)
        .where(eq(topics.id, topicId))
        .for("update");
      const [backend] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      if (!backend) throw new Error("missing backend pid");
      locked.resolve(backend.pid);
      await released;
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
      await waitFor(async () => {
        const [blocked] = await db.execute<{ count: number }>(sql`
          select count(*)::int as count from pg_stat_activity
          where ${pid} = ANY(pg_blocking_pids(pid))
        `);
        return (blocked?.count ?? 0) > 0;
      });
    } finally {
      release();
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
