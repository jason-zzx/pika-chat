import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GenerationRow } from "@/server/services/generation.service";

/**
 * Admission-level contract of POST /api/chat.
 *
 * The route no longer produces the answer inline: it validates + admits
 * (delegated to `prepareSendTurn`/`admitTurn`) and then answers with a
 * subscription to the executor. These tests pin that seam: what the response
 * carries, what happens on a duplicate/finished/deleted/conflicting request,
 * and that a failed admission never reaches the stream.
 */

const {
  requireActor,
  prepareSendTurn,
  sendRequestHash,
  admitTurn,
  findGenerationForActor,
  ensureGenerationRunning,
  subscribeToGeneration,
  finishedGenerationChunks,
  loadMessagesByIds,
  getTranslations,
  getLocale,
} = vi.hoisted(() => ({
  requireActor: vi.fn(),
  prepareSendTurn: vi.fn(),
  sendRequestHash: vi.fn(),
  admitTurn: vi.fn(),
  findGenerationForActor: vi.fn(),
  ensureGenerationRunning: vi.fn(),
  subscribeToGeneration: vi.fn(),
  finishedGenerationChunks: vi.fn(),
  loadMessagesByIds: vi.fn(),
  getTranslations: vi.fn(),
  getLocale: vi.fn(),
}));

vi.mock("@/server/auth/actor", () => ({ requireActor }));
vi.mock("@/server/ai/generation-turn", () => ({
  prepareSendTurn,
  sendRequestHash,
}));
vi.mock("@/server/services/generation.service", () => ({
  admitTurn,
  findGenerationForActor,
}));
vi.mock("@/server/ai/generation-runner", () => ({
  ensureGenerationRunning,
  subscribeToGeneration,
  finishedGenerationChunks,
}));
vi.mock("@/server/services/message.service", () => ({ loadMessagesByIds }));
vi.mock("next-intl/server", () => ({ getTranslations, getLocale }));

const { POST } = await import("./route");

const actor = { userId: "user-1", role: "user" as const };

function generationRow(overrides: Partial<GenerationRow> = {}): GenerationRow {
  return {
    id: "gen-1",
    userId: "user-1",
    requestId: null,
    requestHash: "hash",
    requestExpiresAt: null,
    kind: "send",
    status: "queued",
    topicId: "topic-1",
    assistantMessageId: "msg-1",
    targetDeletedAt: null,
    input: null,
    errorMessage: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

function request(body: Record<string, unknown> = {}): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      assistantId: "a1",
      providerConfigId: "cfg-1",
      modelId: "m-1",
      message: { id: "u-1", role: "user", parts: [{ type: "text", text: "hi" }] },
      ...body,
    }),
  });
}

function chunksStream(chunks: object[]): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      controller.enqueue("data: [DONE]\n\n");
      controller.close();
    },
  });
}

function sseBody(text: string): string {
  return text;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireActor.mockResolvedValue(actor);
  getTranslations.mockResolvedValue((key: string) => key);
  getLocale.mockResolvedValue("en");
  sendRequestHash.mockReturnValue("hash");
  // Default admission behaviour: run the preparation thunk (as the real
  // `admitTurn` does after a receipt miss) and return a fresh task.
  admitTurn.mockImplementation(
    async (_input: unknown, prepare: () => Promise<unknown>) => {
      await prepare();
      return { generation: generationRow(), duplicate: false };
    },
  );
  prepareSendTurn.mockResolvedValue({
    kind: "send",
    assistantId: "a1",
    requestHash: "hash",
    historyMessageIds: [],
    defaultTopicTitle: "New topic",
    titleCandidate: true,
    actorRole: "user",
  });
  loadMessagesByIds.mockResolvedValue([]);
});

describe("POST /api/chat admission", () => {
  it("streams the accepted generation with its topic framing and id header", async () => {
    admitTurn.mockResolvedValue({
      generation: generationRow(),
      duplicate: false,
    });
    findGenerationForActor.mockResolvedValue(generationRow({ status: "running" }));
    ensureGenerationRunning.mockResolvedValue({ state: {} });
    subscribeToGeneration.mockReturnValue(
      chunksStream([
        { type: "data-topic", data: { topicId: "topic-1", streamId: "gen-1" } },
        { type: "start", messageId: "msg-1" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "hi" },
      ]),
    );

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("x-pika-generation-id")).toBe("gen-1");
    // The topic id + stream id travel in the stream exactly as before, but the
    // stream id is now the durable generation id the stop endpoint takes.
    // The fake producer yields strings, so the SSE encoder quotes each frame;
    // what matters is the protocol content.
    const body = sseBody(await response.text());
    expect(body).toContain("data-topic");
    expect(body).toContain("streamId");
    expect(body).toContain("gen-1");
    expect(body).toContain("delta");
  });

  it("passes the request locale, sentinel title and role into preparation", async () => {
    // The default admitTurn mock runs the preparation thunk.
    findGenerationForActor.mockResolvedValue(generationRow({ status: "running" }));
    ensureGenerationRunning.mockResolvedValue({ state: {} });
    subscribeToGeneration.mockReturnValue(chunksStream([]));

    await POST(request());

    expect(prepareSendTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultTopicTitle: "newTopic",
        locale: "en",
        actorRole: "user",
      }),
      actor,
    );
  });

  it("forwards the client requestId and the payload digest to admission", async () => {
    admitTurn.mockResolvedValue({
      generation: generationRow(),
      duplicate: true,
    });
    findGenerationForActor.mockResolvedValue(generationRow({ status: "running" }));
    ensureGenerationRunning.mockResolvedValue({ state: {} });
    subscribeToGeneration.mockReturnValue(chunksStream([]));

    await POST(request({ requestId: "0190a5c0-0000-7000-8000-000000000000" }));

    // The digest is computed from the raw body so admission can look the
    // receipt up BEFORE any preparation runs.
    expect(sendRequestHash).toHaveBeenCalledWith(
      expect.objectContaining({ assistantId: "a1", modelId: "m-1" }),
    );
    expect(admitTurn).toHaveBeenCalledWith(
      {
        requestId: "0190a5c0-0000-7000-8000-000000000000",
        requestHash: "hash",
      },
      expect.any(Function),
      actor,
    );
  });

  it("does not prepare the turn when a receipt already answers the request", async () => {
    admitTurn.mockResolvedValue({
      generation: generationRow(),
      duplicate: true,
    });
    findGenerationForActor.mockResolvedValue(generationRow({ status: "running" }));
    ensureGenerationRunning.mockResolvedValue({ state: {} });
    subscribeToGeneration.mockReturnValue(chunksStream([]));

    await POST(request({ requestId: "0190a5c0-0000-7000-8000-000000000000" }));

    // Preparation (model/attachment capability checks) only runs inside the
    // thunk admission invokes after the receipt lookup misses.
    expect(prepareSendTurn).not.toHaveBeenCalled();
  });

  it("replays a finished generation instead of calling the model again", async () => {
    const finished = generationRow({
      status: "completed",
      finishedAt: new Date("2026-01-01T00:00:05.000Z"),
    });
    admitTurn.mockResolvedValue({ generation: finished, duplicate: true });
    findGenerationForActor.mockResolvedValue(finished);
    loadMessagesByIds.mockResolvedValue([
      {
        id: "msg-1",
        role: "assistant",
        parts: [{ type: "text", text: "answer" }],
        metadata: { outcome: "completed" },
      },
    ]);
    finishedGenerationChunks.mockReturnValue([
      { type: "start", messageId: "msg-1" },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "answer" },
      { type: "text-end", id: "t1" },
      { type: "finish" },
    ]);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(ensureGenerationRunning).not.toHaveBeenCalled();
    expect(finishedGenerationChunks).toHaveBeenCalledWith(
      finished,
      expect.objectContaining({ id: "msg-1" }),
    );
    expect(await response.text()).toContain("answer");
  });

  it("rejects a deleted target with 410", async () => {
    const deleted = generationRow({
      status: "stopped",
      targetDeletedAt: new Date("2026-01-01T00:01:00.000Z"),
    });
    admitTurn.mockResolvedValue({ generation: deleted, duplicate: true });
    findGenerationForActor.mockResolvedValue(deleted);

    const response = await POST(request());

    expect(response.status).toBe(410);
    const body = (await response.json()) as { error: { messageKey: string } };
    expect(body.error.messageKey).toBe("generation.targetDeleted");
  });

  it("surfaces a topic conflict as 409 without opening a stream", async () => {
    const { AppError } = await import("@/server/errors");
    admitTurn.mockRejectedValue(
      new AppError("CONFLICT", 409, "generation.topicBusy"),
    );

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(subscribeToGeneration).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const { AppError } = await import("@/server/errors");
    requireActor.mockRejectedValue(
      new AppError("UNAUTHENTICATED", 401, "auth.required"),
    );

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(prepareSendTurn).not.toHaveBeenCalled();
  });
});
