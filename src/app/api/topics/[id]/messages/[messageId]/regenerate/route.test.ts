import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regeneration is the same admission/executor pair as /api/chat, with two
 * route-level differences worth pinning: it keeps the legacy
 * `x-pika-stream-id` header (now carrying the generation id) and it must
 * forward the edit payload untouched to `prepareRegenerateTurn`, which owns
 * every validation that has to happen before a write.
 */

const {
  requireActor,
  prepareRegenerateTurn,
  regenerateRequestHash,
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
  prepareRegenerateTurn: vi.fn(),
  regenerateRequestHash: vi.fn(),
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
  prepareRegenerateTurn,
  regenerateRequestHash,
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

const generation = {
  id: "gen-9",
  userId: "user-1",
  requestId: null,
  requestHash: "hash",
  requestExpiresAt: null,
  kind: "regenerate" as const,
  status: "queued" as const,
  topicId: "t1",
  assistantMessageId: "m2",
  targetDeletedAt: null,
  input: null,
  errorMessage: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  startedAt: null,
  finishedAt: null,
};

function call(body: Record<string, unknown> = {}) {
  return POST(
    new Request("http://localhost/api/topics/t1/messages/m2/regenerate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerConfigId: "c1", modelId: "m1", ...body }),
    }),
    { params: Promise.resolve({ id: "t1", messageId: "m2" }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  requireActor.mockResolvedValue(actor);
  getTranslations.mockResolvedValue((key: string) => key);
  getLocale.mockResolvedValue("en");
  prepareRegenerateTurn.mockResolvedValue({
    kind: "regenerate",
    assistantId: "a1",
    topicId: "t1",
    targetMessageId: "m2",
    requestHash: "hash",
    historyMessageIds: [],
    assistantMessageId: "m2",
    actorRole: "user",
  });
  regenerateRequestHash.mockReturnValue("hash");
  // Default admission behaviour: run the preparation thunk (as the real
  // `admitTurn` does once a receipt lookup misses).
  admitTurn.mockImplementation(
    async (_input: unknown, prepare: () => Promise<unknown>) => {
      await prepare();
      return { generation, duplicate: false };
    },
  );
  findGenerationForActor.mockResolvedValue({ ...generation, status: "running" });
  ensureGenerationRunning.mockResolvedValue({ state: {} });
  loadMessagesByIds.mockResolvedValue([]);
  subscribeToGeneration.mockReturnValue(
    new ReadableStream<string>({
      start(controller) {
        controller.enqueue(
          `data: ${JSON.stringify({ type: "start", messageId: "m2" })}\n\n`,
        );
        controller.enqueue("data: [DONE]\n\n");
        controller.close();
      },
    }),
  );
});

describe("POST regenerate", () => {
  it("streams the accepted regeneration under the legacy header name", async () => {
    const response = await call();

    expect(response.status).toBe(200);
    // Same header the old inline route used; the value is the durable
    // generation id that /api/chat/stop accepts.
    expect(response.headers.get("x-pika-stream-id")).toBe("gen-9");
    // No data-topic: the view already knows the topic it is regenerating in.
    expect(await response.text()).not.toContain("data-topic");
  });

  it("forwards the edit payload to preparation, which validates before writing", async () => {
    await call({
      edit: {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "edited" }],
      },
    });

    expect(prepareRegenerateTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        topicId: "t1",
        messageId: "m2",
        defaultTopicTitle: "newTopic",
        locale: "en",
      }),
      actor,
    );
  });

  it("passes the request id and the payload digest as the dedupe key", async () => {
    await call({ requestId: "0190a5c0-0000-7000-8000-000000000000" });
    expect(regenerateRequestHash).toHaveBeenCalledWith({
      topicId: "t1",
      messageId: "m2",
      request: expect.objectContaining({ providerConfigId: "c1" }),
    });
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
    admitTurn.mockResolvedValue({ generation, duplicate: true });

    await call({ requestId: "0190a5c0-0000-7000-8000-000000000000" });

    // A retry of an accepted edit/regenerate must not re-run validation that
    // may now fail (disabled model, deleted attachment).
    expect(prepareRegenerateTurn).not.toHaveBeenCalled();
  });

  it("maps a preparation failure to its status and opens no stream", async () => {
    const { AppError } = await import("@/server/errors");
    admitTurn.mockRejectedValue(
      new AppError("VALIDATION_FAILED", 400, "image.invalidParams"),
    );

    const response = await call();

    expect(response.status).toBe(400);
    expect(ensureGenerationRunning).not.toHaveBeenCalled();
    expect(subscribeToGeneration).not.toHaveBeenCalled();
  });

  it("rejects a busy topic with 409", async () => {
    const { AppError } = await import("@/server/errors");
    admitTurn.mockRejectedValue(
      new AppError("CONFLICT", 409, "generation.topicBusy"),
    );

    expect((await call()).status).toBe(409);
  });

  it("replays a finished regeneration instead of re-running it", async () => {
    admitTurn.mockResolvedValue({
      generation: { ...generation, status: "completed" },
      duplicate: true,
    });
    findGenerationForActor.mockResolvedValue({
      ...generation,
      status: "completed",
    });
    loadMessagesByIds.mockResolvedValue([
      {
        id: "m2",
        role: "assistant",
        parts: [{ type: "text", text: "replayed" }],
        metadata: { outcome: "completed" },
      },
    ]);
    finishedGenerationChunks.mockReturnValue([
      { type: "start", messageId: "m2" },
      { type: "finish" },
    ]);

    const response = await call();

    expect(response.status).toBe(200);
    expect(ensureGenerationRunning).not.toHaveBeenCalled();
    expect(finishedGenerationChunks).toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const { AppError } = await import("@/server/errors");
    requireActor.mockRejectedValue(
      new AppError("UNAUTHENTICATED", 401, "auth.required"),
    );

    expect((await call()).status).toBe(401);
    expect(prepareRegenerateTurn).not.toHaveBeenCalled();
  });
});
