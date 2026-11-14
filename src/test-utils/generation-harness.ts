import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { eq } from "drizzle-orm";
import { expect } from "vitest";

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
import {
  resetGenerationRunnerForTests,
  stopGenerationRunner,
} from "@/server/ai/generation-runner";
import { resetLiveGenerations } from "@/server/ai/generation-registry";
import type { ChatChunk } from "@/server/ai/generation-stream";
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
import { createAssistant } from "@/server/services/assistant.service";
import {
  admitTurn,
  type GenerationRow,
  type PreparedTurn,
} from "@/server/services/generation.service";
import { listTopicMessages } from "@/server/services/message.service";
import { createTopicForChat } from "@/server/services/topic.service";

/**
 * Shared fixtures for the server-managed generation integration tests: a clean
 * database with signed-in users, prepared/admitted turns and one local
 * OpenAI-compatible provider (no paid network, no mocked runner).
 */

const db = getDb();

type Actor = Awaited<ReturnType<typeof requireActor>>;

export async function resetState(): Promise<void> {
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

export async function resetRunner(): Promise<void> {
  await stopGenerationRunner();
  resetGenerationRunnerForTests();
  resetLiveGenerations();
}

/**
 * Fresh database with two signed-in accounts (the owner and a stranger), the
 * owner's assistant with an empty topic, and `baseUrl` as the owner's provider
 * `cfg-local` serving `gpt-4o` (plus `gpt-image-1` on request).
 */
export async function seedChat(
  baseUrl: string,
  options: { model?: Partial<typeof providerModels.$inferInsert>; imageModel?: boolean } = {},
): Promise<{ actor: Actor; otherActor: Actor; assistantId: string; topicId: string }> {
  await resetState();
  const setup = await postSetup(jsonRequest("/api/setup", { body: adminCredentials }));
  expect(setup.status).toBe(201);
  const signedIn: Actor[] = [];
  for (const credentials of [userCredentials, otherAdminCredentials]) {
    const created = await authPost(
      jsonRequest("/api/auth/admin/create-user", {
        cookie: cookiesFrom(setup),
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
    const session = await authPost(
      jsonRequest("/api/auth/sign-in/email", {
        body: { email: credentials.email, password: credentials.password },
      }),
    );
    expect(session.status).toBe(200);
    signedIn.push(
      await requireActor(jsonRequest("/api/topics", { cookie: cookiesFrom(session) }).headers),
    );
  }
  const actor = signedIn[0]!;
  await db.insert(providerConfigs).values({
    id: "cfg-local",
    ownerId: actor.userId,
    name: "Local",
    baseUrl,
  });
  await db.insert(providerModels).values({
    id: "pm-local",
    providerConfigId: "cfg-local",
    modelId: "gpt-4o",
    // `user`: the row declares its own metadata, so catalog hydration keeps
    // these values instead of replacing them with defaults.
    metadataSource: "user",
    contextTokens: 256_000,
    inputModalities: ["text", "image", "pdf"],
    ...options.model,
  });
  if (options.imageModel) {
    await db.insert(providerModels).values({
      id: "pm-local-image",
      providerConfigId: "cfg-local",
      modelId: "gpt-image-1",
      metadataSource: "user",
      inputModalities: ["text", "image"],
      outputModalities: ["image"],
    });
  }
  const assistant = await createAssistant({ name: "Owner", icon: "✨" }, actor);
  const topic = await createTopicForChat({ assistantId: assistant.id }, actor, "New topic");
  return { actor, otherActor: signedIn[1]!, assistantId: assistant.id, topicId: topic.id };
}

/** A send turn as preparation would freeze it, without running preparation. */
export function preparedTurn(
  input: {
    assistantId: string;
    topicId?: string | null;
    userMessageId?: string;
  } & Partial<PreparedTurn>,
): PreparedTurn {
  const { userMessageId = "u-1", ...turn } = input;
  return {
    kind: "send",
    topicId: null,
    providerConfigId: "cfg-local",
    modelId: "gpt-4o",
    historyMessageIds: [],
    userMessage: {
      message: {
        id: userMessageId,
        role: "user",
        parts: [{ type: "text", text: "hello" }],
      },
      // The prepared message carries resolved file parts alongside; the turn
      // only needs the model-facing text here.
    } as unknown as PreparedTurn["userMessage"],
    defaultTopicTitle: "New topic",
    titleCandidate: false,
    actorRole: "user",
    requestHash: "hash-send",
    ...turn,
  };
}

export function admitPrepared(
  turn: PreparedTurn,
  actor: Actor,
  options: { requestId?: string } = {},
) {
  return admitTurn(
    { requestId: options.requestId, requestHash: turn.requestHash },
    async () => turn,
    actor,
  );
}

export async function generationRow(id: string): Promise<GenerationRow | undefined> {
  const rows = await db.select().from(chatGenerations).where(eq(chatGenerations.id, id));
  return rows[0];
}

export async function assistantText(topicId: string, actor: Actor): Promise<string> {
  const messages = await listTopicMessages({ topicId }, actor);
  return (messages.find((message) => message.role === "assistant")?.parts ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export async function waitFor<T>(
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
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export async function drainStream(
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
    ...(usage && {
      usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens },
    }),
  })}\n\n`;
}

type ChatCall = {
  messages?: { role: string; content: unknown }[];
  /** Streaming requests are answers; title and summary calls are not. */
  stream?: boolean;
};

const providerDefaults = () => ({
  /** Text deltas a streaming answer sends; non-streaming calls reply with their join. */
  deltas: ["Hello"],
  /** Delay after each delta, so a test can observe the mid-answer state. */
  deltaDelayMs: 0,
  /** Keep the answer open after the deltas until released or disconnected. */
  holdOpen: false,
  failWithStatus: null as number | null,
  /** Every chat-completions body received, in order. */
  calls: [] as ChatCall[],
  /** Raw bodies of `/images/*` calls (JSON generations and multipart edits). */
  imageCalls: [] as string[],
  /** Streaming answers currently open, and the most open at once. */
  open: 0,
  peakOpen: 0,
  /** Responses the client closed before they ended. */
  aborted: 0,
  holds: [] as (() => void)[],
});

/** Local OpenAI-compatible endpoint. Tests mutate its fields to script it. */
export async function startFakeProvider() {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    response.on("close", () => {
      if (!response.writableEnded) {
        provider.aborted += 1;
      }
    });
    request.on("end", () => {
      void (async () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (request.url?.includes("/images/")) {
          provider.imageCalls.push(raw);
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({ data: [{ b64_json: Buffer.from("fake-png").toString("base64") }] }),
          );
          return;
        }
        const body: ChatCall = JSON.parse(raw);
        provider.calls.push(body);
        const script = { ...provider };
        if (body.stream !== true) {
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
                  message: { role: "assistant", content: script.deltas.join("") },
                  finish_reason: "stop",
                },
              ],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }),
          );
          return;
        }
        if (script.failWithStatus !== null) {
          response.writeHead(script.failWithStatus, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: { message: "provider exploded" } }));
          return;
        }
        provider.open += 1;
        provider.peakOpen = Math.max(provider.peakOpen, provider.open);
        response.once("close", () => {
          provider.open -= 1;
        });
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        for (const delta of script.deltas) {
          if (response.destroyed) {
            return;
          }
          response.write(sseChunk({ content: delta }, null));
          if (script.deltaDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, script.deltaDelayMs));
          }
        }
        if (script.holdOpen) {
          await new Promise<void>((resolve) => {
            provider.holds.push(resolve);
            response.once("close", resolve);
          });
        }
        if (response.destroyed) {
          return;
        }
        response.write(sseChunk({}, "stop", { prompt_tokens: 5, completion_tokens: 7 }));
        response.write("data: [DONE]\n\n");
        response.end();
      })();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const provider = {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    ...providerDefaults(),
    /** Lets every held answer finish. */
    release: () => provider.holds.splice(0).forEach((resolve) => resolve()),
    reset: () => Object.assign(provider, providerDefaults()),
    close: () => server.close(),
  };
  return provider;
}
