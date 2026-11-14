import "server-only";

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ensureGenerationRunning,
  stopGenerationById,
  subscribeToGeneration,
} from "@/server/ai/generation-runner";
import { getLiveGeneration } from "@/server/ai/generation-registry";
import {
  prepareRegenerateTurn,
  prepareSendTurn,
} from "@/server/ai/generation-turn";
import { getDb } from "@/server/db/client";
import { chatMessages, files, topics } from "@/server/db/schema";
import { uploadFile } from "@/server/files/file.service";
import { getFileStorage } from "@/server/files/storage";
import { logger } from "@/server/logger";
import type { GenerationRow } from "@/server/services/generation.service";
import {
  appendUserMessage,
  appendUserMessageVersion,
  insertAssistantPlaceholder,
  listTopicMessages,
  writeAssistantTurnRow,
} from "@/server/services/message.service";
import { createTopicForChat, deleteTopic } from "@/server/services/topic.service";
import {
  admitPrepared,
  assistantText,
  drainStream,
  generationRow,
  resetRunner,
  resetState,
  seedChat,
  startFakeProvider,
  waitFor,
} from "@/test-utils/generation-harness";

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
const provider = await startFakeProvider();

afterAll(() => provider.close());

beforeEach(async () => {
  provider.reset();
  await resetRunner();
});

afterEach(async () => {
  provider.release();
  await resetRunner();
  // Balanced put/delete: the shared integration setup fails the suite when an
  // object survives its test, and these tests upload real attachments.
  const stored = await db.select({ key: files.storageKey }).from(files);
  const storage = getFileStorage();
  for (const row of stored) {
    await storage.delete(row.key).catch(() => undefined);
  }
  await resetState();
});

type Seed = Awaited<ReturnType<typeof seedChat>>;

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

async function runToCompletion(generation: GenerationRow): Promise<void> {
  await ensureGenerationRunning(generation.id);
  await waitFor(async () => {
    const row = await generationRow(generation.id);
    return row && row.status !== "queued" && row.status !== "running";
  });
}

/**
 * Fails the next transaction, i.e. the I/O boundary of the terminal write
 * (nothing else in the turn path opens one after admission). With `commit`
 * the transaction runs for real and only its acknowledgement is lost — the
 * case where retrying finds a terminal row that already holds the answer.
 * Every later transaction runs the real service, locks and SQL.
 */
function faultTerminalWrite(options: { commit: boolean }): {
  failures: () => number;
  restore: () => void;
} {
  const original = db.transaction.bind(db) as (
    run: unknown,
    config?: unknown,
  ) => Promise<unknown>;
  let failures = 0;
  const spy = vi.spyOn(db, "transaction");
  spy.mockImplementation((((run: unknown, config?: unknown) => {
    if (failures > 0) {
      return original(run, config);
    }
    failures += 1;
    if (!options.commit) {
      return Promise.reject(new Error("simulated terminal write failure"));
    }
    return original(run, config).then(() => {
      throw new Error("simulated lost acknowledgement");
    });
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
      providerConfigId: "cfg-local",
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

/** Uploads one attachment for the actor and returns its canonical part inputs. */
async function upload(
  actor: Seed["actor"],
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
  it("sends the edited message exactly once in place of the group's selected version", async () => {
    const seed = await seedChat(provider.baseUrl);
    const topicId = await topicWithHistory(seed, [
      { role: "user", text: "first version" },
      { role: "assistant", text: "original answer" },
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
          providerConfigId: "cfg-local",
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
    // version), not the clicked id; the executor appends the edit itself.
    expect(prepared.historyMessageIds).toEqual([]);

    const { generation } = await admitPrepared(prepared, seed.actor);
    await runToCompletion(generation);

    const answerCall = provider.calls.find((call) =>
      JSON.stringify(call.messages).includes("edited text"),
    );
    const serialized = JSON.stringify(answerCall!.messages);
    expect(serialized.split("edited text")).toHaveLength(2);
    expect(serialized).not.toContain("second version");
    expect(serialized).not.toContain("first version");
    // The regenerated answer's own text is not history either.
    expect(serialized).not.toContain("original answer");

    const stored = await listTopicMessages({ topicId }, seed.actor);
    expect(stored.map((message) => message.id)).toContain("edited-version");
  });
});

describe("generation execution: attachments", () => {
  it("persists the canonical attachment identity instead of the client's claim", async () => {
    const seed = await seedChat(provider.baseUrl);
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

    const { generation } = await admitPrepared(prepared, seed.actor);
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
    expect(JSON.stringify(provider.calls[0]!.messages)).toContain("attachment body");
  });

  it("rejects an unroutable attachment", async () => {
    const seed = await seedChat(provider.baseUrl, { model: { inputModalities: ["text"] } });
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
  });

  it("checks only the attachments that are actually sent", async () => {
    const seed = await seedChat(provider.baseUrl, { model: { inputModalities: ["text"] } });
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
        request: { providerConfigId: "cfg-local", modelId: "gpt-4o" },
        defaultTopicTitle: "New topic",
        actorRole: "user",
      },
      seed.actor,
    );
    // A text-only model regenerating an answer whose history contains an image
    // it will not receive must be admitted, not rejected.
    expect(prepared.summary?.text).toBe("earlier summary");

    const { generation } = await admitPrepared(prepared, seed.actor);
    await runToCompletion(generation);
    const answerCall = provider.calls.find((call) =>
      JSON.stringify(call.messages).includes("follow-up"),
    );
    expect(answerCall).toBeDefined();
    expect(JSON.stringify(answerCall!.messages)).not.toContain("with picture");
    expect(JSON.stringify(answerCall!.messages)).toContain("earlier summary");
  });
});

describe("generation execution: image regeneration pre-flight", () => {
  it("refuses a regeneration whose reference image is gone", async () => {
    const seed = await seedChat(provider.baseUrl, { imageModel: true });
    const file = await upload(seed.actor, {
      filename: "reference.png",
      mediaType: "image/png",
      data: "png-bytes",
    });
    const topicId = await topicWithHistory(seed, [
      { role: "user", text: "edit this", files: [file.url] },
      { role: "assistant", text: "old image" },
    ]);
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
            providerConfigId: "cfg-local",
            modelId: "gpt-image-1",
            image: { size: "1024x1024" },
          },
          defaultTopicTitle: "New topic",
          actorRole: "user",
        },
        seed.actor,
      ),
    ).rejects.toMatchObject({ messageKey: "file.notFound" });

    expect(provider.imageCalls).toHaveLength(0);
  });

  it("resolves the reference image from the source message before generating", async () => {
    const seed = await seedChat(provider.baseUrl, { imageModel: true });
    const file = await upload(seed.actor, {
      filename: "reference.png",
      mediaType: "image/png",
      data: "png-bytes",
    });
    const topicId = await topicWithHistory(seed, [
      { role: "user", text: "edit this", files: [file.url] },
      { role: "assistant", text: "old image" },
    ]);

    const prepared = await prepareRegenerateTurn(
      {
        topicId,
        messageId: (await listTopicMessages({ topicId }, seed.actor))[1]!.id,
        request: {
          providerConfigId: "cfg-local",
          modelId: "gpt-image-1",
          image: { size: "1024x1024" },
        },
        defaultTopicTitle: "New topic",
        actorRole: "user",
      },
      seed.actor,
    );
    const { generation } = await admitPrepared(prepared, seed.actor);
    await runToCompletion(generation);

    expect(provider.imageCalls).toHaveLength(1);
    // gpt-image sends references through the multipart edits form: the
    // pre-flight and the executor resolved the same source message bytes.
    expect(provider.imageCalls[0]).toContain('name="image[]"');
    expect(provider.imageCalls[0]).toContain("png-bytes");
    const stored = await listTopicMessages({ topicId }, seed.actor);
    expect(stored.length).toBe(2);
  });
});

describe("generation execution: failure persistence", () => {
  it("does not expose a background storage exception in history or logs", async () => {
    const seed = await seedChat(provider.baseUrl, { imageModel: true });
    const file = await upload(seed.actor, {
      filename: "reference.png", mediaType: "image/png", data: "png-bytes",
    });
    const request = sendRequest({
      assistantId: seed.assistantId, text: "draw",
      files: [{ url: file.url, mediaType: "image/png" }],
    });
    request.request.modelId = "gpt-image-1";
    const prepared = await prepareSendTurn(request, seed.actor);
    const { generation } = await admitPrepared(prepared, seed.actor);
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
      expect(provider.imageCalls).toHaveLength(0);
    } finally {
      read.mockRestore();
      log.mockRestore();
    }
  });

  it("commits failure before the error chunk can end the client reader", async () => {
    const seed = await seedChat(provider.baseUrl);
    provider.failWithStatus = 400;
    const prepared = await prepareSendTurn(
      sendRequest({ assistantId: seed.assistantId, text: "fail please" }),
      seed.actor,
    );
    const { generation } = await admitPrepared(prepared, seed.actor);
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

  it("recovers a terminal write that failed once instead of wedging the topic", async () => {
    const seed = await seedChat(provider.baseUrl);
    provider.deltas = ["answer that must survive a write failure"];
    const prepared = await prepareSendTurn(
      sendRequest({ assistantId: seed.assistantId, text: "keep this" }),
      seed.actor,
    );
    const { generation } = await admitPrepared(prepared, seed.actor);
    const faults = faultTerminalWrite({ commit: false });
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
      expect(await assistantText(generation.topicId!, seed.actor)).toBe(
        "answer that must survive a write failure",
      );
      // Exactly one finish chunk, delivered after the commit, and one model call.
      expect(collected.filter((chunk) => chunk.type === "finish")).toHaveLength(1);
      expect(provider.calls.filter((call) => call.stream)).toHaveLength(1);
      expect(getLiveGeneration(generation.id)).toBeUndefined();
    } finally {
      faults.restore();
    }
  });

  it.each(["stop", "delete"] as const)("cleans pending images only after %s decides a failed save", async (action) => {
    const seed = await seedChat(provider.baseUrl, { imageModel: true });
    const request = sendRequest({ assistantId: seed.assistantId, text: "draw" });
    request.request.modelId = "gpt-image-1";
    const prepared = await prepareSendTurn(request, seed.actor);
    const { generation } = await admitPrepared(prepared, seed.actor);
    const faults = faultTerminalWrite({ commit: false });
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
      expect(provider.imageCalls).toHaveLength(1);
      expect(getLiveGeneration(generation.id)).toBeUndefined();
    } finally {
      faults.restore();
    }
  });

  it("keeps a committed answer when its acknowledgement is lost", async () => {
    const seed = await seedChat(provider.baseUrl, { imageModel: true });
    const request = sendRequest({ assistantId: seed.assistantId, text: "draw" });
    request.request.modelId = "gpt-image-1";
    const prepared = await prepareSendTurn(request, seed.actor);
    const { generation } = await admitPrepared(prepared, seed.actor);
    const faults = faultTerminalWrite({ commit: true });
    try {
      const entry = await ensureGenerationRunning(generation.id);
      if (!entry) throw new Error("missing generation");
      const chunks = await drainStream(subscribeToGeneration(entry).getReader());

      expect(faults.failures()).toBe(1);
      expect((await generationRow(generation.id))?.status).toBe("completed");
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
      expect(chunks.filter((chunk) => chunk.type === "finish")).toHaveLength(1);
      expect(provider.imageCalls).toHaveLength(1);
    } finally {
      faults.restore();
    }
  });

  it.each(["stopped", "failed"] as const)("announces %s after a lost terminal acknowledgement", async (outcome) => {
    const seed = await seedChat(provider.baseUrl);
    provider.holdOpen = outcome === "stopped";
    provider.failWithStatus = outcome === "failed" ? 400 : null;
    const prepared = await prepareSendTurn(
      sendRequest({ assistantId: seed.assistantId, text: "terminal receipt" }),
      seed.actor,
    );
    const { generation } = await admitPrepared(prepared, seed.actor);
    const faults = faultTerminalWrite({ commit: true });
    try {
      const entry = await ensureGenerationRunning(generation.id);
      if (!entry) throw new Error("missing generation");
      const reading = drainStream(subscribeToGeneration(entry).getReader());
      if (outcome === "stopped") {
        await waitFor(() => entry.state.message.parts.some(part => part.type === "text"));
        await stopGenerationById(generation.id, seed.actor);
      }
      const chunks = await reading;
      expect(faults.failures()).toBe(1);
      expect((await generationRow(generation.id))?.status).toBe(outcome);
      expect(chunks.filter(chunk => chunk.type === (outcome === "stopped" ? "abort" : "error"))).toHaveLength(1);
      expect(chunks.some(chunk => chunk.type === "finish")).toBe(false);
      expect(provider.calls.filter((call) => call.stream)).toHaveLength(1);
      expect(getLiveGeneration(generation.id)).toBeUndefined();
    } finally {
      faults.restore();
    }
  });
});

describe("generation execution: answer metadata", () => {
  it("persists the usage/finish feedback that reached the live state and names the topic", async () => {
    const seed = await seedChat(provider.baseUrl);
    provider.deltas = ["Weather in Paris"];
    const prepared = await prepareSendTurn(
      sendRequest({ assistantId: seed.assistantId, text: "how long" }),
      seed.actor,
    );
    const { generation } = await admitPrepared(prepared, seed.actor);
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
    // The first completed turn names its topic on the server, from the model's
    // title reply (not the user-text fallback), with no client involved.
    await waitFor(async () => {
      const [topic] = await db
        .select({ title: topics.title })
        .from(topics)
        .where(eq(topics.id, generation.topicId!));
      return topic?.title === "Weather in Paris";
    });
  });

  it("announces the placeholder's group/version identity while it streams", async () => {
    const seed = await seedChat(provider.baseUrl);
    const topicId = await topicWithHistory(seed, [
      { role: "user", text: "first" },
      { role: "assistant", text: "answer" },
    ]);
    const messages = await listTopicMessages({ topicId }, seed.actor);
    provider.holdOpen = true;

    const prepared = await prepareRegenerateTurn(
      {
        topicId,
        messageId: messages[1]!.id,
        request: { providerConfigId: "cfg-local", modelId: "gpt-4o" },
        defaultTopicTitle: "New topic",
        actorRole: "user",
      },
      seed.actor,
    );
    const { generation } = await admitPrepared(prepared, seed.actor);
    const live = await ensureGenerationRunning(generation.id);
    if (!live) throw new Error("missing live turn");

    // The resumed stream replaces the seeded message in place: it must carry
    // the group it joined and the version count after this turn's row.
    await waitFor(() => live.state.message.metadata?.groupId !== undefined);
    expect(live.state.message.metadata).toMatchObject({
      groupId: messages[1]!.metadata?.groupId,
      versionIndex: 2,
      versionCount: 2,
    });
    const reader = subscribeToGeneration(live).getReader();
    await waitFor(() => provider.holds.length > 0);
    provider.release();
    let finishes = 0;
    for (const value of await drainStream(reader)) {
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
    const seed = await seedChat(provider.baseUrl);
    provider.holdOpen = true;
    const generations: GenerationRow[] = [];
    for (let index = 0; index < 5; index += 1) {
      const topic = await createTopicForChat(
        { assistantId: seed.assistantId },
        seed.actor,
        "New topic",
      );
      const prepared = await prepareSendTurn(
        sendRequest({
          assistantId: seed.assistantId,
          topicId: topic.id,
          text: `question ${index}`,
        }),
        seed.actor,
      );
      const { generation } = await admitPrepared(prepared, seed.actor);
      generations.push(generation);
    }

    await Promise.all(generations.map((generation) => ensureGenerationRunning(generation.id)));

    // All five provider requests are open at the same time: execution is per
    // topic, not a global queue.
    await waitFor(() => provider.peakOpen >= 5);
    expect(provider.open).toBe(5);

    provider.release();
    await waitFor(async () => {
      const rows = await Promise.all(generations.map((generation) => generationRow(generation.id)));
      return rows.every((row) => row?.status === "completed");
    });
  });
});

describe("generation execution: compression", () => {
  it("auto-compresses its own frozen history without blocking on its own turn", async () => {
    // A tiny context window so the first send crosses the 80% threshold.
    const seed = await seedChat(provider.baseUrl, { model: { contextTokens: 200 } });
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

    const { generation } = await admitPrepared(prepared, seed.actor);
    await runToCompletion(generation);

    // Two provider calls: the summary and the answer.
    const summaryCall = provider.calls.find((call) =>
      JSON.stringify(call.messages).includes("<messages>"),
    );
    const answerCall = provider.calls.find((call) =>
      JSON.stringify(call.messages).includes("new question"),
    );
    // The auto path really ran — it was not refused by its own generation row.
    expect(summaryCall).toBeDefined();
    expect(answerCall).toBeDefined();
    const summaryPrompt = JSON.stringify(summaryCall!.messages);
    // It summarized the frozen PRE-TURN history only.
    expect(summaryPrompt).toContain(longText.slice(0, 40));
    expect(summaryPrompt).not.toContain("new question");

    const [topic] = await db.select().from(topics).where(eq(topics.id, topicId));
    expect(topic?.summaryText ?? "").not.toBe("");
    // The boundary is the last pre-turn message, never this turn's own rows.
    expect(topic?.summaryUpToMessageId).toBe(beforeTurn[1]!.id);

    // The answer was generated from the post-boundary history plus the new
    // message, with the summary carried in the instructions.
    const answerMessages = JSON.stringify(answerCall!.messages);
    expect(answerMessages).toContain("new question");
    expect(answerMessages).not.toContain(longText.slice(0, 40));
    expect(answerMessages).toContain(topic?.summaryText ?? "<never>");
  });
});

describe("generation execution: model resolution", () => {
  it("resolves the text model only once per turn execution", async () => {
    const seed = await seedChat(provider.baseUrl);
    const resolveModel = await import("@/server/ai/require-model");
    const spy = vi.spyOn(resolveModel, "requireModelForActor");
    try {
      const prepared = await prepareSendTurn(
        sendRequest({ assistantId: seed.assistantId, text: "single resolve" }),
        seed.actor,
      );
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockClear();

      const { generation } = await admitPrepared(prepared, seed.actor);
      await runToCompletion(generation);

      // Background execution resolves the model once (for the turn; title
      // generation uses createChatModelHandle directly without requireModelForActor).
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
