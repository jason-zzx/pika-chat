import "server-only";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { isActiveGenerationStatus } from "@/lib/schemas/generation";
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
  ensureGenerationRunning,
  resetGenerationRunnerForTests,
  startGenerationRunner,
  stopGenerationRunner,
  stopGenerationById,
  subscribeToGeneration,
} from "@/server/ai/generation-runner";
import {
  getLiveGeneration,
  resetLiveGenerations,
} from "@/server/ai/generation-registry";
import {
  prepareRegenerateTurn,
  prepareSendTurn,
} from "@/server/ai/generation-turn";
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
import { uploadFile } from "@/server/files/file.service";
import { getFileStorage } from "@/server/files/storage";
import { logger } from "@/server/logger";
import { createAssistant } from "@/server/services/assistant.service";
import {
  admitTurn,
  checkpointGeneration,
  type GenerationRow,
  type PreparedTurn,
} from "@/server/services/generation.service";
import { requireModelForActor } from "@/server/ai/require-model";
import {
  appendUserMessage,
  appendUserMessageVersion,
  insertAssistantPlaceholder,
  listTopicMessages,
  resolveRegenerateTarget,
  writeAssistantTurnRow,
} from "@/server/services/message.service";
import { compressTopicHistory } from "@/server/services/compression.service";
import { createTopicForChat, deleteTopic } from "@/server/services/topic.service";

/**
 * Real preparation + real executor behaviour (chat task R1/R4/R6/R7).
 *
 * The coverage here replaces what the two inline POST routes used to own and
 * what their deletion left behind: `prepareSendTurn`/`prepareRegenerateTurn`
 * run for real, the executor runs for real, and the only fake is the provider
 * on a local HTTP socket. Assertions are about the bytes the model receives,
 * the rows the turn persists and what never gets written at all.
 */

const db = getDb();

type ChatCall = {
  body: {
    messages?: { role: string; content: unknown }[];
    tools?: unknown[];
    /** Streaming requests are the answers; title naming is non-streaming. */
    stream?: boolean;
  };
};

/** Provider calls that stream an answer (title naming is a separate call). */
function answerCalls(): ChatCall[] {
  return chatCalls.filter((call) => call.body.stream === true);
}

let server: Server;
let baseUrl = "";
/** Every chat-completions body the provider received, in order. */
let chatCalls: ChatCall[] = [];
/** Number of chat requests that arrived and are still open. */
let openRequests = 0;
let peakOpenRequests = 0;
let holdOpen = false;
let failWithStatus: number | null = null;
let responseText = "Hello";
let imageCalls: { body: Record<string, unknown>; raw: string }[] = [];
let releaseHolds: (() => void)[] = [];

function sseChunk(
  delta: Record<string, unknown>,
  finish: string | null,
  usage?: { prompt_tokens: number; completion_tokens: number },
): string {
  return `data: ${JSON.stringify({
    id: "cmpl-test",
    object: "chat.completion.chunk",
    created: 1,
    model: "gpt-4o",
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(usage === undefined
      ? {}
      : {
          usage: {
            ...usage,
            total_tokens: usage.prompt_tokens + usage.completion_tokens,
          },
        }),
  })}\n\n`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      void (async () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (request.url?.includes("/images/")) {
          // Both wire shapes: JSON `/images/generations` and multipart
          // `/images/edits` (reference images). The raw body is kept so the
          // edit form's attached bytes can be asserted.
          imageCalls.push({
            body:
              raw.length > 0 && raw.trimStart().startsWith("{")
                ? JSON.parse(raw)
                : {},
            raw,
          });
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              data: [{ b64_json: Buffer.from("fake-png").toString("base64") }],
            }),
          );
          return;
        }
        const parsed = raw.length > 0 ? JSON.parse(raw) : {};
        chatCalls.push({ body: parsed });
        // `generateText` (summary / title) asks for a non-streaming completion;
        // the answer path streams.
        if (parsed.stream !== true) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              id: "cmpl-test",
              object: "chat.completion",
              created: 1,
              model: "gpt-4o",
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: responseText },
                  finish_reason: "stop",
                },
              ],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }),
          );
          return;
        }
        openRequests += 1;
        peakOpenRequests = Math.max(peakOpenRequests, openRequests);
        if (failWithStatus !== null) {
          openRequests -= 1;
          response.writeHead(failWithStatus, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: { message: "provider exploded" } }));
          return;
        }
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        response.write(sseChunk({ content: responseText }, null));
        if (holdOpen) {
          await new Promise<void>((resolve) => {
            releaseHolds.push(() => resolve());
            response.once("close", () => resolve());
          });
        }
        response.write(
          sseChunk({}, "stop", { prompt_tokens: 5, completion_tokens: 7 }),
        );
        response.write("data: [DONE]\n\n");
        response.end();
        openRequests -= 1;
      })();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  chatCalls = [];
  imageCalls = [];
  openRequests = 0;
  peakOpenRequests = 0;
  holdOpen = false;
  failWithStatus = null;
  responseText = "Hello";
  releaseHolds = [];
  resetGenerationRunnerForTests();
  resetLiveGenerations();
});

afterEach(async () => {
  for (const release of releaseHolds) {
    release();
  }
  await stopGenerationRunner();
  resetGenerationRunnerForTests();
  resetLiveGenerations();
  // Balanced put/delete: the shared integration setup fails the suite when an
  // object survives its test, and these tests upload real attachments.
  const stored = await db.select({ key: files.storageKey }).from(files);
  const storage = getFileStorage();
  for (const row of stored) {
    await storage.delete(row.key).catch(() => undefined);
  }
  await resetState();
});

type Actor = Awaited<ReturnType<typeof requireActor>>;

async function resetState(): Promise<void> {
  await db.delete(chatGenerations);
  await db.delete(chatMessages);
  await db.delete(topics);
  await db.delete(assistants);
  await db.delete(files);
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

type Seed = {
  actor: Actor;
  assistantId: string;
};

/** One user with an assistant and the local text provider (no real network). */
async function seedChat(
  options: {
    inputModalities?: string[];
    contextTokens?: number;
    withImageModel?: boolean;
  } = {},
): Promise<Seed> {
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
  const response = await authPost(
    jsonRequest("/api/auth/sign-in/email", {
      body: {
        email: userCredentials.email,
        password: userCredentials.password,
      },
    }),
  );
  const cookie = cookiesFrom(response);
  const actor = await requireActor(jsonRequest("/api/topics", { cookie }).headers);

  await db.insert(providerConfigs).values({
    id: "cfg-exec",
    ownerId: actor.userId,
    name: "Local",
    baseUrl,
  });
  await db.insert(providerModels).values({
    id: "pm-exec",
    providerConfigId: "cfg-exec",
    modelId: "gpt-4o",
    // `user`: the row declares its own metadata, so catalog hydration keeps
    // these values instead of replacing them with defaults.
    metadataSource: "user",
    contextTokens: options.contextTokens ?? 256_000,
    inputModalities: options.inputModalities ?? ["text", "image", "pdf"],
  });
  if (options.withImageModel) {
    await db.insert(providerModels).values({
      id: "pm-exec-image",
      providerConfigId: "cfg-exec",
      modelId: "gpt-image-1",
      metadataSource: "user",
      inputModalities: ["text", "image"],
      outputModalities: ["image"],
    });
  }
  const assistant = await createAssistant({ name: "Owner", icon: "✨" }, actor);
  return { actor, assistantId: assistant.id };
}

async function topicWithHistory(
  seed: Seed,
  messages: { role: "user" | "assistant"; text: string; files?: string[] }[],
): Promise<string> {
  const topic = await createTopicForChat(
    { assistantId: seed.assistantId },
    seed.actor,
    "New topic",
  );
  for (const message of messages) {
    const parts = [
      ...(message.files ?? []).map((url) => ({
        type: "file" as const,
        url,
        mediaType: "image/png",
        filename: "reference.png",
      })),
      ...(message.text.length > 0
        ? [{ type: "text" as const, text: message.text }]
        : []),
    ];
    if (message.role === "user") {
      await appendUserMessage(
        {
          topicId: topic.id,
          message: { id: `msg-${Math.random().toString(36).slice(2)}`, role: "user", parts },
        },
        seed.actor,
      );
      continue;
    }
    const placeholder = await insertAssistantPlaceholder(
      { topicId: topic.id, id: `msg-${Math.random().toString(36).slice(2)}` },
      seed.actor,
    );
    await writeAssistantTurnRow(db, {
      topicId: topic.id,
      messageId: placeholder.id,
      parts,
      outcome: "completed",
    });
  }
  return topic.id;
}

async function waitFor<T>(
  check: () => Promise<T | null | false | undefined> | T | null | false | undefined,
  timeoutMs = 10_000,
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

async function generationRow(id: string): Promise<GenerationRow | undefined> {
  const rows = await db
    .select()
    .from(chatGenerations)
    .where(eq(chatGenerations.id, id));
  return rows[0];
}

async function runToCompletion(generation: GenerationRow): Promise<void> {
  await ensureGenerationRunning(generation.id);
  await waitFor(async () => {
    const row = await generationRow(generation.id);
    return row && row.status !== "queued" && row.status !== "running";
  });
}

/**
 * Fails the next `times` transactions, i.e. the I/O boundary of the terminal
 * write (nothing else in the turn path opens one after admission). The real
 * service, its locks and its SQL still run on every attempt that is allowed
 * through — only the failing commit boundary is simulated.
 */
function failTerminalWrites(times: number): {
  failures: () => number;
  restore: () => void;
} {
  const original = db.transaction.bind(db) as (
    run: unknown,
    config?: unknown,
  ) => Promise<unknown>;
  let remaining = times;
  let failures = 0;
  const spy = vi.spyOn(db, "transaction");
  spy.mockImplementation((((run: unknown, config?: unknown) => {
    if (remaining > 0) {
      remaining -= 1;
      failures += 1;
      return Promise.reject(new Error("simulated terminal write failure"));
    }
    return original(run, config);
  }) as unknown) as typeof db.transaction);
  return { failures: () => failures, restore: () => spy.mockRestore() };
}

/**
 * Runs the next transaction for real (it COMMITS) but then fails the call from
 * the caller's point of view — a lost acknowledgement, the case where retrying
 * finds a terminal row that already holds the answer.
 */
function loseTerminalAcknowledgement(): {
  failures: () => number;
  restore: () => void;
} {
  const original = db.transaction.bind(db) as (
    run: unknown,
    config?: unknown,
  ) => Promise<unknown>;
  let remaining = 1;
  let failures = 0;
  const spy = vi.spyOn(db, "transaction");
  spy.mockImplementation((((run: unknown, config?: unknown) => {
    const committed = original(run, config);
    if (remaining > 0) {
      remaining -= 1;
      failures += 1;
      return committed.then(() => {
        throw new Error("simulated lost acknowledgement");
      });
    }
    return committed;
  }) as unknown) as typeof db.transaction);
  return { failures: () => failures, restore: () => spy.mockRestore() };
}

function sendRequest(input: {
  assistantId: string;
  topicId?: string;
  text: string;
  files?: { url: string; mediaType: string; filename?: string }[];
}): Parameters<typeof prepareSendTurn>[0] {
  return {
    request: {
      assistantId: input.assistantId,
      ...(input.topicId ? { topicId: input.topicId } : {}),
      providerConfigId: "cfg-exec",
      modelId: "gpt-4o",
      message: {
        id: `u-${Math.random().toString(36).slice(2)}`,
        role: "user",
        parts: [
          ...(input.files ?? []).map((file) => ({
            type: "file" as const,
            url: file.url,
            mediaType: file.mediaType,
            ...(file.filename ? { filename: file.filename } : {}),
          })),
          ...(input.text.length > 0
            ? [{ type: "text" as const, text: input.text }]
            : []),
        ],
      },
    },
    defaultTopicTitle: "New topic",
    actorRole: "user",
    locale: "en",
  };
}

async function countsFor(actor: Actor): Promise<{
  topics: number;
  messages: number;
  generations: number;
}> {
  const ownedTopics = await db
    .select({ id: topics.id })
    .from(topics)
    .innerJoin(assistants, eq(assistants.id, topics.assistantId))
    .where(eq(assistants.ownerId, actor.userId));
  const [messages, generations] = await Promise.all([
    db.select({ id: chatMessages.id }).from(chatMessages),
    db
      .select({ id: chatGenerations.id })
      .from(chatGenerations)
      .where(eq(chatGenerations.userId, actor.userId)),
  ]);
  return {
    topics: ownedTopics.length,
    messages: messages.length,
    generations: generations.length,
  };
}

function admitPreparedTurn(prepared: PreparedTurn, actor: Actor) {
  return admitTurn(
    { requestHash: prepared.requestHash },
    async () => prepared,
    actor,
  );
}

/** Uploads one attachment for the actor and returns its canonical part inputs. */
async function upload(
  actor: Actor,
  input: { filename: string; mediaType: string; data: string },
): Promise<{ id: string; url: string }> {
  const uploaded = await uploadFile(
    {
      filename: input.filename,
      mediaType: input.mediaType,
      data: Buffer.from(input.data),
    },
    actor,
  );
  return { id: uploaded.id, url: uploaded.url };
}

describe("generation execution: edit context", () => {
  it("sends the edited message exactly once and drops the version it replaces", async () => {
    const seed = await seedChat();
    const topicId = await topicWithHistory(seed, [
      { role: "user", text: "original question" },
      { role: "assistant", text: "original answer" },
    ]);
    const messages = await listTopicMessages({ topicId }, seed.actor);
    const userMessageId = messages[0]!.id;

    const editId = "edit-version-1";
    const prepared = await prepareRegenerateTurn(
      {
        topicId,
        messageId: userMessageId,
        request: {
          providerConfigId: "cfg-exec",
          modelId: "gpt-4o",
          edit: {
            id: editId,
            role: "user",
            parts: [{ type: "text", text: "edited question" }],
          },
        },
        defaultTopicTitle: "New topic",
        actorRole: "user",
      },
      seed.actor,
    );
    // The edit is not part of the frozen history: the executor appends it.
    expect(prepared.historyMessageIds).not.toContain(editId);
    expect(prepared.historyMessageIds).not.toContain(userMessageId);

    const { generation } = await admitPreparedTurn(prepared, seed.actor);
    await runToCompletion(generation);

    // One answer call (a pending-titled topic also triggers the best-effort
    // server-side title request; that is not part of what is asserted here).
    const answerCall = chatCalls.find((call) =>
      JSON.stringify(call.body.messages).includes("edited question"),
    );
    expect(answerCall).toBeDefined();
    const serialized = JSON.stringify(answerCall!.body.messages);
    expect(serialized.split("edited question")).toHaveLength(2);
    expect(serialized).not.toContain("original question");
    // The regenerated answer's own text is not history either.
    expect(serialized).not.toContain("original answer");

    const stored = await listTopicMessages({ topicId }, seed.actor);
    expect(stored.map((message) => message.id)).toContain(editId);
  });

  it("replaces the group's selected version when the older one is edited", async () => {
    const seed = await seedChat();
    const topicId = await topicWithHistory(seed, [
      { role: "user", text: "first version" },
      { role: "assistant", text: "answer" },
    ]);
    const [firstVersion] = await listTopicMessages({ topicId }, seed.actor);
    // A second version becomes selected; the client still edits the first one.
    await appendUserMessageVersion(
      {
        topicId,
        groupId: firstVersion!.metadata!.groupId!,
        message: {
          id: "user-version-2",
          role: "user",
          parts: [{ type: "text", text: "second version" }],
        },
      },
      seed.actor,
    );

    const prepared = await prepareRegenerateTurn(
      {
        topicId,
        messageId: firstVersion!.id,
        request: {
          providerConfigId: "cfg-exec",
          modelId: "gpt-4o",
          edit: {
            id: "edited-version",
            role: "user",
            parts: [{ type: "text", text: "edited text" }],
          },
        },
        defaultTopicTitle: "New topic",
        actorRole: "user",
      },
      seed.actor,
    );
    // The frozen history dropped the group's SELECTED row (the second
    // version), not the clicked id.
    expect(prepared.historyMessageIds).toEqual([]);

    const { generation } = await admitPreparedTurn(prepared, seed.actor);
    await runToCompletion(generation);

    const answerCall = chatCalls.find((call) =>
      JSON.stringify(call.body.messages).includes("edited text"),
    );
    const serialized = JSON.stringify(answerCall!.body.messages);
    expect(serialized.split("edited text")).toHaveLength(2);
    expect(serialized).not.toContain("second version");
    expect(serialized).not.toContain("first version");
  });
});

describe("generation execution: attachments", () => {
  it("persists the canonical attachment identity instead of the client's claim", async () => {
    const seed = await seedChat();
    const file = await upload(seed.actor, {
      filename: "server-name.txt",
      mediaType: "text/plain",
      data: "attachment body",
    });

    const prepared = await prepareSendTurn(
      sendRequest({
        assistantId: seed.assistantId,
        text: "read this",
        files: [{ url: file.url, mediaType: "text/plain", filename: "client-name.txt" }],
      }),
      seed.actor,
    );
    const parts = prepared.userMessage?.message.parts ?? [];
    const filePart = parts.find((part) => part.type === "file");
    expect(filePart).toMatchObject({
      filename: "server-name.txt",
      mediaType: "text/plain",
      sizeBytes: Buffer.byteLength("attachment body"),
    });

    const { generation } = await admitPreparedTurn(prepared, seed.actor);
    await runToCompletion(generation);

    // The persisted message keeps the canonical part, so a later replay and
    // the attachment card agree with the files table.
    const stored = await listTopicMessages(
      { topicId: generation.topicId! },
      seed.actor,
    );
    expect(stored[0]!.parts.find((part) => part.type === "file")).toMatchObject({
      filename: "server-name.txt",
    });
    // And the extracted text reached the model.
    expect(JSON.stringify(chatCalls[0]!.body.messages)).toContain("attachment body");
  });

  it("rejects an unroutable attachment without writing anything", async () => {
    const seed = await seedChat({ inputModalities: ["text"] });
    const file = await upload(seed.actor, {
      filename: "picture.png",
      mediaType: "image/png",
      data: "png-bytes",
    });

    await expect(
      prepareSendTurn(
        sendRequest({
          assistantId: seed.assistantId,
          text: "look",
          files: [{ url: file.url, mediaType: "image/png" }],
        }),
        seed.actor,
      ),
    ).rejects.toMatchObject({ messageKey: "file.imageRequiresVision" });

    expect(await countsFor(seed.actor)).toEqual({
      topics: 0,
      messages: 0,
      generations: 0,
    });
    expect(chatCalls).toHaveLength(0);
  });

  it("checks only the attachments that are actually sent", async () => {
    const seed = await seedChat({ inputModalities: ["text"] });
    const file = await upload(seed.actor, {
      filename: "picture.png",
      mediaType: "image/png",
      data: "png-bytes",
    });
    // The image sits inside the compressed zone, so the turn never sends it;
    // the later turns keep the clipped history non-empty.
    const topicId = await topicWithHistory(seed, [
      { role: "user", text: "with picture", files: [file.url] },
      { role: "assistant", text: "answer" },
      { role: "user", text: "follow-up" },
      { role: "assistant", text: "follow-up answer" },
    ]);
    const messages = await listTopicMessages({ topicId }, seed.actor);
    await db
      .update(topics)
      .set({
        summaryText: "earlier summary",
        summaryUpToMessageId: messages[0]!.id,
      })
      .where(eq(topics.id, topicId));

    const prepared = await prepareRegenerateTurn(
      {
        topicId,
        messageId: messages[3]!.id,
        request: { providerConfigId: "cfg-exec", modelId: "gpt-4o" },
        defaultTopicTitle: "New topic",
        actorRole: "user",
      },
      seed.actor,
    );
    // A text-only model regenerating an answer whose history contains an image
    // it will not receive must be admitted, not rejected.
    expect(prepared.summary?.text).toBe("earlier summary");

    const { generation } = await admitPreparedTurn(prepared, seed.actor);
    await runToCompletion(generation);
    const answerCall = chatCalls.find((call) =>
      JSON.stringify(call.body.messages).includes("follow-up"),
    );
    expect(answerCall).toBeDefined();
    expect(JSON.stringify(answerCall!.body.messages)).not.toContain("with picture");
    expect(JSON.stringify(answerCall!.body.messages)).toContain("earlier summary");
  });
});

describe("generation execution: image regeneration pre-flight", () => {
  it("discards uploaded images when a stop wins against a waiting final save", async () => {
    const seed = await seedChat({ withImageModel: true });
    const request = sendRequest({ assistantId: seed.assistantId, text: "draw" });
    request.request.modelId = "gpt-image-1";
    const prepared = await prepareSendTurn(request, seed.actor);
    const { generation } = await admitPreparedTurn(prepared, seed.actor);
    const topicId = generation.topicId;
    if (!topicId) throw new Error("missing topic");
    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const blocker = db.transaction(async tx => {
      await tx.select().from(topics).where(eq(topics.id, topicId)).for("update");
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    try {
      const entry = await ensureGenerationRunning(generation.id);
      if (!entry) throw new Error("missing live generation");
      // The batch is fully uploaded, but finalize cannot acquire the topic.
      await waitFor(() => entry.pendingTerminal?.type === "finish");
      expect(await db.select().from(files)).toHaveLength(1);
      await stopGenerationById(generation.id, seed.actor);
      release.resolve();
      await blocker;
      await entry.settled;
      expect((await generationRow(generation.id))?.status).toBe("stopped");
      const messages = await listTopicMessages({ topicId }, seed.actor);
      expect(messages[1]?.metadata?.outcome).toBe("stopped");
      expect(messages[1]?.parts).toEqual([]);
      expect(await db.select().from(files)).toEqual([]);
      expect(imageCalls).toHaveLength(1);
    } finally {
      release.resolve();
      await blocker;
    }
  });

  it("refuses a regeneration whose reference image is gone, before any write", async () => {
    const seed = await seedChat({ withImageModel: true });
    const file = await upload(seed.actor, {
      filename: "reference.png",
      mediaType: "image/png",
      data: "png-bytes",
    });
    const topicId = await topicWithHistory(seed, [
      { role: "user", text: "edit this", files: [file.url] },
      { role: "assistant", text: "old image" },
    ]);
    const before = await countsFor(seed.actor);
    // The stored bytes/row disappear before the user regenerates (object and
    // row both, so the storage leak invariant stays meaningful).
    const [storedFile] = await db
      .select()
      .from(files)
      .where(eq(files.id, file.id));
    await getFileStorage().delete(storedFile!.storageKey);
    await db.delete(files).where(eq(files.id, file.id));

    await expect(
      prepareRegenerateTurn(
        {
          topicId,
          messageId: (await listTopicMessages({ topicId }, seed.actor))[1]!.id,
          request: {
            providerConfigId: "cfg-exec",
            modelId: "gpt-image-1",
            image: { size: "1024x1024" },
          },
          defaultTopicTitle: "New topic",
          actorRole: "user",
        },
        seed.actor,
      ),
    ).rejects.toMatchObject({ messageKey: "file.notFound" });

    expect(await countsFor(seed.actor)).toEqual(before);
    expect(imageCalls).toHaveLength(0);
  });

  it("resolves the reference image from the source message before generating", async () => {
    const seed = await seedChat({ withImageModel: true });
    const file = await upload(seed.actor, {
      filename: "reference.png",
      mediaType: "image/png",
      data: "png-bytes",
    });
    const topicId = await topicWithHistory(seed, [
      { role: "user", text: "edit this", files: [file.url] },
      { role: "assistant", text: "old image" },
    ]);
    const target = await resolveRegenerateTarget(
      {
        topicId,
        messageId: (await listTopicMessages({ topicId }, seed.actor))[1]!.id,
      },
      seed.actor,
    );
    expect(target.targetGroupId).not.toBeNull();

    const prepared = await prepareRegenerateTurn(
      {
        topicId,
        messageId: (await listTopicMessages({ topicId }, seed.actor))[1]!.id,
        request: {
          providerConfigId: "cfg-exec",
          modelId: "gpt-image-1",
          image: { size: "1024x1024" },
        },
        defaultTopicTitle: "New topic",
        actorRole: "user",
      },
      seed.actor,
    );
    const { generation } = await admitPreparedTurn(prepared, seed.actor);
    await runToCompletion(generation);

    expect(imageCalls).toHaveLength(1);
    // gpt-image sends references through the multipart edits form: the
    // pre-flight and the executor resolved the same source message bytes.
    expect(imageCalls[0]!.raw).toContain('name="image[]"');
    expect(imageCalls[0]!.raw).toContain("png-bytes");
    const stored = await listTopicMessages({ topicId }, seed.actor);
    expect(stored.length).toBe(2);
  });
});

describe("generation execution: failure persistence", () => {
  it("does not expose a background storage exception in history or logs", async () => {
    const seed = await seedChat({ withImageModel: true });
    const file = await upload(seed.actor, {
      filename: "reference.png", mediaType: "image/png", data: "png-bytes",
    });
    const request = sendRequest({
      assistantId: seed.assistantId, text: "draw",
      files: [{ url: file.url, mediaType: "image/png" }],
    });
    request.request.modelId = "gpt-image-1";
    const prepared = await prepareSendTurn(request, seed.actor);
    const { generation } = await admitPreparedTurn(prepared, seed.actor);
    // Preflight succeeded; the background reference read now fails.
    const read = vi.spyOn(getFileStorage(), "get")
      .mockRejectedValueOnce(new Error("private-storage-secret"));
    const log = vi.spyOn(logger, "error");
    try {
      await runToCompletion(generation);
      const row = await generationRow(generation.id);
      expect(row?.status).toBe("failed");
      expect(row?.errorMessage).toBeTruthy();
      expect(row?.errorMessage).not.toContain("private-storage-secret");
      const messages = await listTopicMessages({ topicId: generation.topicId! }, seed.actor);
      expect(messages[1]?.metadata?.errorMessage).toBe(row?.errorMessage);
      expect(log).toHaveBeenCalledWith(
        { generationId: generation.id, errorName: "Error" },
        "generation turn failed",
      );
      expect(imageCalls).toHaveLength(0);
    } finally {
      read.mockRestore();
      log.mockRestore();
    }
  });

  it("commits failure before the error chunk can end the client reader", async () => {
    const seed = await seedChat();
    failWithStatus = 400;
    const prepared = await prepareSendTurn(
      sendRequest({ assistantId: seed.assistantId, text: "fail please" }),
      seed.actor,
    );
    const { generation } = await admitPreparedTurn(prepared, seed.actor);
    const entry = await ensureGenerationRunning(generation.id);
    if (!entry) throw new Error("missing generation");
    const reader = subscribeToGeneration(entry).getReader();
    let sawError = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value.type !== "error") continue;
      sawError = true;
      expect((await generationRow(generation.id))?.status).toBe("failed");
      const messages = await listTopicMessages({ topicId: generation.topicId! }, seed.actor);
      expect(messages[1]?.metadata?.outcome).toBe("failed");
      expect(messages[1]?.metadata?.errorMessage).toBe(value.errorText);
    }
    expect(sawError).toBe(true);
  });

  it("stores the provider failure instead of a silent completed answer", async () => {
    const seed = await seedChat();
    failWithStatus = 500;

    const prepared = await prepareSendTurn(
      sendRequest({ assistantId: seed.assistantId, text: "fail please" }),
      seed.actor,
    );
    const { generation } = await admitPreparedTurn(prepared, seed.actor);
    await runToCompletion(generation);

    const row = await generationRow(generation.id);
    expect(row?.status).toBe("failed");
    const stored = await listTopicMessages(
      { topicId: generation.topicId! },
      seed.actor,
    );
    const answer = stored.find((message) => message.role === "assistant");
    expect(answer?.metadata?.outcome).toBe("failed");
    expect(answer?.metadata?.errorMessage ?? "").not.toBe("");
  });

  it("recovers a terminal write that failed once instead of wedging the topic", async () => {
    const seed = await seedChat();
    responseText = "answer that must survive a write failure";
    const prepared = await prepareSendTurn(
      sendRequest({ assistantId: seed.assistantId, text: "keep this" }),
      seed.actor,
    );
    const { generation } = await admitPreparedTurn(prepared, seed.actor);
    const faults = failTerminalWrites(1);
    try {
      const entry = await ensureGenerationRunning(generation.id);
      if (!entry) throw new Error("missing generation");
      const collected: { type: string }[] = [];
      const reader = subscribeToGeneration(entry).getReader();
      const readAll = (async () => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          collected.push(value);
        }
      })();

      // The terminal transaction failed: the turn must stay live (not look
      // finished, not release the only copy of the answer) and the row must
      // still be active at that point.
      await waitFor(() => faults.failures() === 1);
      expect((await generationRow(generation.id))?.status).toBe("running");
      expect(getLiveGeneration(generation.id)).toBeDefined();
      expect(collected.some((chunk) => chunk.type === "finish")).toBe(false);

      // …and the same process commits it once the write goes through again.
      await waitFor(
        async () => (await generationRow(generation.id))?.status === "completed",
      );
      await readAll;

      const messages = await listTopicMessages(
        { topicId: generation.topicId! },
        seed.actor,
      );
      const answer = messages.find((message) => message.role === "assistant");
      expect(answer?.id).toBe(generation.assistantMessageId);
      expect(answer?.metadata?.outcome).toBe("completed");
      expect(
        (answer?.parts ?? [])
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join(""),
      ).toBe("answer that must survive a write failure");
      // Exactly one finish chunk, delivered after the commit, and one model call.
      expect(collected.filter((chunk) => chunk.type === "finish")).toHaveLength(1);
      expect(answerCalls()).toHaveLength(1);
      expect(getLiveGeneration(generation.id)).toBeUndefined();
    } finally {
      faults.restore();
    }
  });

  it("keeps a turn's images until the pending save is decided", async () => {
    const seed = await seedChat({ withImageModel: true });
    const request = sendRequest({ assistantId: seed.assistantId, text: "draw" });
    request.request.modelId = "gpt-image-1";
    const prepared = await prepareSendTurn(request, seed.actor);
    const { generation } = await admitPreparedTurn(prepared, seed.actor);
    const faults = failTerminalWrites(1);
    try {
      await ensureGenerationRunning(generation.id);
      await waitFor(() => faults.failures() === 1);
      // Undecided: the batch is uploaded and must not be reclaimed while the
      // content that references it may still be committed.
      expect(await db.select().from(files)).toHaveLength(1);
      expect((await generationRow(generation.id))?.status).toBe("running");

      await waitFor(
        async () => (await generationRow(generation.id))?.status === "completed",
      );

      const messages = await listTopicMessages(
        { topicId: generation.topicId! },
        seed.actor,
      );
      const answer = messages.find((message) => message.role === "assistant");
      expect(answer?.metadata?.outcome).toBe("completed");
      expect((answer?.parts ?? []).some((part) => part.type === "file")).toBe(true);
      // The committed answer still owns its image.
      expect(await db.select().from(files)).toHaveLength(1);
      expect(imageCalls).toHaveLength(1);
    } finally {
      faults.restore();
    }
  });

  it.each(["stop", "delete"] as const)("cleans pending images only after %s decides a failed save", async (action) => {
    const seed = await seedChat({ withImageModel: true });
    const request = sendRequest({ assistantId: seed.assistantId, text: "draw" });
    request.request.modelId = "gpt-image-1";
    const prepared = await prepareSendTurn(request, seed.actor);
    const { generation } = await admitPreparedTurn(prepared, seed.actor);
    const faults = failTerminalWrites(1);
    try {
      const entry = await ensureGenerationRunning(generation.id);
      if (!entry || !generation.topicId) throw new Error("missing generation");
      await waitFor(() => faults.failures() === 1);
      expect(await db.select().from(files)).toHaveLength(1);
      if (action === "stop") {
        await stopGenerationById(generation.id, seed.actor);
      } else {
        await deleteTopic(generation.topicId, seed.actor);
      }
      await entry.settled;
      expect(await db.select().from(files)).toEqual([]);
      expect((await generationRow(generation.id))?.status).toBe("stopped");
      if (action === "stop") {
        const messages = await listTopicMessages({ topicId: generation.topicId }, seed.actor);
        expect(messages.find(message => message.role === "assistant")).toMatchObject({
          parts: [], metadata: { outcome: "stopped" },
        });
      } else {
        expect(await db.select().from(chatMessages)).toEqual([]);
        expect(entry.discarded).toBe(true);
      }
      expect(imageCalls).toHaveLength(1);
      expect(getLiveGeneration(generation.id)).toBeUndefined();
    } finally {
      faults.restore();
    }
  });

  it("keeps a committed answer when its acknowledgement is lost", async () => {
    const seed = await seedChat({ withImageModel: true });
    const request = sendRequest({ assistantId: seed.assistantId, text: "draw" });
    request.request.modelId = "gpt-image-1";
    const prepared = await prepareSendTurn(request, seed.actor);
    const { generation } = await admitPreparedTurn(prepared, seed.actor);
    const faults = loseTerminalAcknowledgement();
    try {
      const entry = await ensureGenerationRunning(generation.id);
      if (!entry) throw new Error("missing generation");
      const collected: { type: string }[] = [];
      const reader = subscribeToGeneration(entry).getReader();
      const readAll = (async () => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          collected.push(value);
        }
      })();

      await waitFor(() => faults.failures() === 1);
      await readAll;

      const row = await generationRow(generation.id);
      expect(row?.status).toBe("completed");
      const messages = await listTopicMessages(
        { topicId: generation.topicId! },
        seed.actor,
      );
      const answer = messages.find((message) => message.role === "assistant");
      expect(answer?.metadata?.outcome).toBe("completed");
      expect((answer?.parts ?? []).some((part) => part.type === "file")).toBe(true);
      // The retry found a `completed` row it did not write itself: that is its
      // own lost acknowledgement, so the committed image must survive.
      expect(await db.select().from(files)).toHaveLength(1);
      // Exactly one completion signal reaches the client.
      expect(collected.filter((chunk) => chunk.type === "finish")).toHaveLength(1);
      expect(imageCalls).toHaveLength(1);
    } finally {
      faults.restore();
    }
  });

  it.each(["stopped", "failed"] as const)("announces %s after a lost terminal acknowledgement", async (outcome) => {
    const seed = await seedChat();
    holdOpen = outcome === "stopped";
    failWithStatus = outcome === "failed" ? 400 : null;
    const prepared = await prepareSendTurn(
      sendRequest({ assistantId: seed.assistantId, text: "terminal receipt" }),
      seed.actor,
    );
    const { generation } = await admitPreparedTurn(prepared, seed.actor);
    const faults = loseTerminalAcknowledgement();
    try {
      const entry = await ensureGenerationRunning(generation.id);
      if (!entry) throw new Error("missing generation");
      const chunks: { type: string }[] = [];
      const reader = subscribeToGeneration(entry).getReader();
      const reading = (async () => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          chunks.push(value);
        }
      })();
      if (outcome === "stopped") {
        await waitFor(() => entry.state.message.parts.some(part => part.type === "text"));
        await stopGenerationById(generation.id, seed.actor);
      }
      await reading;
      expect(faults.failures()).toBe(1);
      expect((await generationRow(generation.id))?.status).toBe(outcome);
      expect(chunks.filter(chunk => chunk.type === (outcome === "stopped" ? "abort" : "error"))).toHaveLength(1);
      expect(chunks.some(chunk => chunk.type === "finish")).toBe(false);
      expect(answerCalls()).toHaveLength(1);
      expect(getLiveGeneration(generation.id)).toBeUndefined();
    } finally {
      faults.restore();
    }
  });

  it("lets a stop decide a turn whose final save is still pending", async () => {
    const seed = await seedChat();
    responseText = "partial answer kept by the stop";
    const prepared = await prepareSendTurn(
      sendRequest({ assistantId: seed.assistantId, text: "keep me" }),
      seed.actor,
    );
    const { generation } = await admitPreparedTurn(prepared, seed.actor);
    const faults = failTerminalWrites(2);
    try {
      await ensureGenerationRunning(generation.id);
      await waitFor(() => faults.failures() === 1);
      expect(getLiveGeneration(generation.id)).toBeDefined();

      // The terminal write is unresolved, but the durable decision still wins:
      // the retry re-reads the row under its lock.
      await stopGenerationById(generation.id, seed.actor);
      await waitFor(
        async () => (await generationRow(generation.id))?.status === "stopped",
      );

      const messages = await listTopicMessages(
        { topicId: generation.topicId! },
        seed.actor,
      );
      const answer = messages.find((message) => message.role === "assistant");
      expect(answer?.metadata?.outcome).toBe("stopped");
      expect(
        (answer?.parts ?? [])
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join(""),
      ).toBe("partial answer kept by the stop");
      expect(answerCalls()).toHaveLength(1);
      expect(getLiveGeneration(generation.id)).toBeUndefined();
    } finally {
      faults.restore();
    }
  });

  it("discards a turn deleted while its final save is still pending", async () => {
    const seed = await seedChat();
    responseText = "answer nobody may read";
    const prepared = await prepareSendTurn(
      sendRequest({ assistantId: seed.assistantId, text: "delete me" }),
      seed.actor,
    );
    const { generation } = await admitPreparedTurn(prepared, seed.actor);
    // One failed terminal write, then the retry is due in ~200ms: the delete
    // below lands while that save is still unresolved.
    const faults = failTerminalWrites(1);
    try {
      const entry = await ensureGenerationRunning(generation.id);
      if (!entry) throw new Error("missing generation");
      await waitFor(() => faults.failures() === 1);
      const topicId = generation.topicId;
      if (!topicId) throw new Error("missing topic");
      // The save is unresolved: the live content is still the only copy.
      expect(getLiveGeneration(generation.id)).toBeDefined();

      await deleteTopic(topicId, seed.actor);
      await entry.settled;

      // Content and subscriptions are cleared as the delete requests, and the
      // pending save cannot bring the deleted data back.
      expect(entry.discarded).toBe(true);
      expect(await db.select().from(chatMessages)).toEqual([]);
      const row = await generationRow(generation.id);
      expect(row?.targetDeletedAt).not.toBeNull();
      expect(isActiveGenerationStatus(row!.status)).toBe(false);
      expect(getLiveGeneration(generation.id)).toBeUndefined();
      expect(answerCalls()).toHaveLength(1);
    } finally {
      faults.restore();
    }
  });
});

describe("generation execution: answer metadata", () => {
  it("persists the usage/finish feedback that reached the live state", async () => {
    const seed = await seedChat();
    const prepared = await prepareSendTurn(
      sendRequest({ assistantId: seed.assistantId, text: "how long" }),
      seed.actor,
    );
    const { generation } = await admitPreparedTurn(prepared, seed.actor);
    await runToCompletion(generation);

    const stored = await listTopicMessages(
      { topicId: generation.topicId! },
      seed.actor,
    );
    const answer = stored.find((message) => message.role === "assistant");
    // Both come from the `finish` chunk merged into the single live state, not
    // from a second SDK-side message copy.
    expect(answer?.metadata?.finishReason).toBe("stop");
    expect(answer?.metadata?.totalTokens).toBe(12);
  });

  it("announces the placeholder's group/version identity while it streams", async () => {
    const seed = await seedChat();
    const topicId = await topicWithHistory(seed, [
      { role: "user", text: "first" },
      { role: "assistant", text: "answer" },
    ]);
    const messages = await listTopicMessages({ topicId }, seed.actor);
    holdOpen = true;

    const prepared = await prepareRegenerateTurn(
      {
        topicId,
        messageId: messages[1]!.id,
        request: { providerConfigId: "cfg-exec", modelId: "gpt-4o" },
        defaultTopicTitle: "New topic",
        actorRole: "user",
      },
      seed.actor,
    );
    const { generation } = await admitPreparedTurn(prepared, seed.actor);
    const live = await ensureGenerationRunning(generation.id);

    // The resumed stream replaces the seeded message in place: it must carry
    // the group it joined and the version count after this turn's row.
    await waitFor(() => live?.state.message.metadata?.groupId !== undefined);
    expect(live?.state.message.metadata).toMatchObject({
      groupId: messages[1]!.metadata?.groupId,
      versionIndex: 2,
      versionCount: 2,
    });
    if (!live) throw new Error("missing live turn");
    const reader = subscribeToGeneration(live).getReader();
    await waitFor(() => releaseHolds.length > 0);
    for (const release of releaseHolds) release();
    let finishes = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value.type === "finish") finishes += 1;
      if (value.type === "start" || value.type === "finish" || value.type === "message-metadata") {
        expect(value.messageMetadata).toMatchObject({
          groupId: messages[1]!.metadata?.groupId,
          versionIndex: 2,
          versionCount: 2,
        });
      }
    }
    expect(finishes).toBe(1);
  });
});

describe("generation execution: parallelism", () => {
  it("starts five different topics without waiting for the previous ones", async () => {
    const seed = await seedChat();
    holdOpen = true;
    const topics: string[] = [];
    const generations: GenerationRow[] = [];
    for (let index = 0; index < 5; index += 1) {
      const topic = await createTopicForChat(
        { assistantId: seed.assistantId },
        seed.actor,
        "New topic",
      );
      topics.push(topic.id);
      const prepared = await prepareSendTurn(
        sendRequest({
          assistantId: seed.assistantId,
          topicId: topic.id,
          text: `question ${index}`,
        }),
        seed.actor,
      );
      const { generation } = await admitPreparedTurn(prepared, seed.actor);
      generations.push(generation);
    }

    await Promise.all(generations.map((generation) => ensureGenerationRunning(generation.id)));

    // All five provider requests are open at the same time: execution is per
    // topic, not a global queue.
    await waitFor(() => peakOpenRequests >= 5);
    expect(openRequests).toBe(5);

    for (const release of releaseHolds) {
      release();
    }
    await waitFor(async () => {
      const rows = await Promise.all(generations.map((generation) => generationRow(generation.id)));
      return rows.every((row) => row?.status === "completed");
    });
  });
});

describe("generation execution: compression", () => {
  it("auto-compresses its own frozen history without blocking on its own turn", async () => {
    // A tiny context window so the first send crosses the 80% threshold.
    const seed = await seedChat({ contextTokens: 200 });
    const longText = "x".repeat(600);
    const topicId = await topicWithHistory(seed, [
      { role: "user", text: longText },
      { role: "assistant", text: longText },
    ]);
    const beforeTurn = await listTopicMessages({ topicId }, seed.actor);

    const prepared = await prepareSendTurn(
      sendRequest({
        assistantId: seed.assistantId,
        topicId,
        text: "new question",
      }),
      seed.actor,
    );
    // The summary the turn was planned against is frozen on the task.
    expect(prepared.summary).toBeNull();

    const { generation } = await admitPreparedTurn(prepared, seed.actor);
    await runToCompletion(generation);

    // Two provider calls: the summary and the answer.
    const summaryCall = chatCalls.find((call) =>
      JSON.stringify(call.body.messages).includes("<messages>"),
    );
    const answerCall = chatCalls.find((call) =>
      JSON.stringify(call.body.messages).includes("new question"),
    );
    // The auto path really ran — it was not refused by its own generation row.
    expect(summaryCall).toBeDefined();
    expect(answerCall).toBeDefined();
    const summaryPrompt = JSON.stringify(summaryCall!.body.messages);
    // It summarized the frozen PRE-TURN history only.
    expect(summaryPrompt).toContain(longText.slice(0, 40));
    expect(summaryPrompt).not.toContain("new question");

    const [topic] = await db.select().from(topics).where(eq(topics.id, topicId));
    expect(topic?.summaryText ?? "").not.toBe("");
    // The boundary is the last pre-turn message, never this turn's own rows.
    expect(topic?.summaryUpToMessageId).toBe(beforeTurn[1]!.id);

    // The answer was generated from the post-boundary history plus the new
    // message, with the summary carried in the instructions.
    const answerMessages = JSON.stringify(answerCall!.body.messages);
    expect(answerMessages).toContain("new question");
    expect(answerMessages).not.toContain(longText.slice(0, 40));
    expect(answerMessages).toContain(topic?.summaryText ?? "<never>");
  });

  it("refuses manual compression while a turn is active", async () => {
    const seed = await seedChat({ contextTokens: 200 });
    const topicId = await topicWithHistory(seed, [
      { role: "user", text: "x".repeat(400) },
      { role: "assistant", text: "x".repeat(400) },
    ]);
    const prepared = await prepareSendTurn(
      sendRequest({ assistantId: seed.assistantId, topicId, text: "hello" }),
      seed.actor,
    );
    await admitPreparedTurn(prepared, seed.actor);

    const { handle } = await requireModelForActor(
      { providerConfigId: "cfg-exec", modelId: "gpt-4o" },
      seed.actor,
    );
    // The manual path keeps the topic lock for the whole operation, so an
    // active turn is a hard conflict rather than a race with the summary write.
    await expect(
      compressTopicHistory({ topicId, handle, exclusive: true }, seed.actor),
    ).rejects.toMatchObject({ messageKey: "generation.topicBusy" });
  });
});

describe("generation execution: checkpoint", () => {
  it("keeps the answer's usage metadata on a crash-retention write", async () => {
    const seed = await seedChat();
    const topicId = await topicWithHistory(seed, [{ role: "user", text: "hi" }]);
    const placeholder = await insertAssistantPlaceholder(
      { topicId, id: "assistant-checkpoint" },
      seed.actor,
    );
    const written = await checkpointGeneration({
      topicId,
      messageId: placeholder.id,
      parts: [{ type: "text", text: "partial" }],
      totalTokens: 42,
      finishReason: "length",
    });
    expect(written).toBe(true);
    const [row] = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.id, placeholder.id));
    expect(row?.totalTokens).toBe(42);
    expect(row?.finishReason).toBe("length");
  });
});

describe("generation execution: boot", () => {
  it("resolves the text model only once per turn execution", async () => {
    const seed = await seedChat();
    const resolveModel = await import("@/server/ai/require-model");
    const spy = vi.spyOn(resolveModel, "requireModelForActor");
    try {
      const prepared = await prepareSendTurn(
        sendRequest({ assistantId: seed.assistantId, text: "single resolve" }),
        seed.actor,
      );
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockClear();

      const { generation } = await admitPreparedTurn(prepared, seed.actor);
      await runToCompletion(generation);

      // Background execution resolves the model once (for the turn; title
      // generation uses createChatModelHandle directly without requireModelForActor).
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("boots the executor from instrumentation without a queued row being lost", async () => {
    const seed = await seedChat();
    const prepared = await prepareSendTurn(
      sendRequest({ assistantId: seed.assistantId, text: "boot me" }),
      seed.actor,
    );
    const { generation } = await admitPreparedTurn(prepared, seed.actor);
    // Admission happens before boot: the sweep must pick the row up.
    await startGenerationRunner();
    await waitFor(async () => (await generationRow(generation.id))?.status === "completed");
    // One answer call (the boot sweep, with no browser), plus the best-effort
    // title request the turn triggers server-side.
    expect(
      chatCalls.some((call) => JSON.stringify(call.body.messages).includes("boot me")),
    ).toBe(true);
    const stored = await listTopicMessages(
      { topicId: generation.topicId! },
      seed.actor,
    );
    expect(stored.find((message) => message.role === "assistant")?.parts).toEqual([
      { type: "text", text: "Hello" },
    ]);
  });
});

