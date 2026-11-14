import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GenerationRow } from "@/server/services/generation.service";

/**
 * The response contract shared by both POST streams and the resume GET
 * (chat task §6):
 *
 * - a live turn attaches the caller as a subscriber in every mode;
 * - a finished turn replays its persisted answer ONLY for the POST that lost
 *   its confirmation, while the resume GET answers 204 so the client refreshes
 *   canonical history instead of receiving the answer twice;
 * - connection establishment authorizes by actor (session revocation rejects
 *   new/reconnected requests while an already-opened subscription drains until
 *   completion or disconnect).
 */

const {
  findGenerationForActor,
  ensureGenerationRunning,
  subscribeToGeneration,
  finishedGenerationChunks,
  loadMessagesByIds,
} = vi.hoisted(() => ({
  findGenerationForActor: vi.fn(),
  ensureGenerationRunning: vi.fn(),
  subscribeToGeneration: vi.fn(),
  finishedGenerationChunks: vi.fn(),
  loadMessagesByIds: vi.fn(),
}));

vi.mock("@/server/services/generation.service", () => ({
  findGenerationForActor,
}));
vi.mock("@/server/ai/generation-runner", () => ({
  ensureGenerationRunning,
  subscribeToGeneration,
  finishedGenerationChunks,
}));
vi.mock("@/server/services/message.service", () => ({ loadMessagesByIds }));

const { respondWithGeneration } = await import("./generation-response");

const actor = { userId: "user-1", role: "user" as const };

function generationRow(overrides: Partial<GenerationRow> = {}): GenerationRow {
  return {
    id: "gen-1",
    userId: "user-1",
    requestId: null,
    requestHash: "hash",
    requestExpiresAt: null,
    kind: "send",
    status: "completed",
    topicId: "topic-1",
    assistantMessageId: "msg-1",
    targetDeletedAt: null,
    input: null,
    errorMessage: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    startedAt: null,
    finishedAt: new Date("2026-01-01T00:00:05.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
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
});

describe("respondWithGeneration", () => {
  it("answers a finished turn on the resume path with 204 and no body", async () => {
    const settled = generationRow({ status: "stopped" });
    findGenerationForActor.mockResolvedValue(settled);

    const response = await respondWithGeneration({
      generationId: "gen-1",
      actor,
      mode: "resume",
    });

    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe("");
    // Resume never replays: the client refetches history for the canonical
    // view, so the persisted answer is not injected a second time.
    expect(loadMessagesByIds).not.toHaveBeenCalled();
    expect(subscribeToGeneration).not.toHaveBeenCalled();
  });

  it("still replays the finished answer for the POST that lost its confirmation", async () => {
    findGenerationForActor.mockResolvedValue(generationRow());

    const response = await respondWithGeneration({
      generationId: "gen-1",
      actor,
      mode: "follow",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-pika-generation-id")).toBe("gen-1");
    expect(finishedGenerationChunks).toHaveBeenCalledWith(
      expect.objectContaining({ id: "gen-1" }),
      expect.objectContaining({ id: "msg-1" }),
    );
    expect(await response.text()).toContain("answer");
  });

  it("refuses a deleted target before opening anything", async () => {
    findGenerationForActor.mockResolvedValue(
      generationRow({
        status: "stopped",
        targetDeletedAt: new Date("2026-01-01T00:02:00.000Z"),
      }),
    );

    await expect(
      respondWithGeneration({ generationId: "gen-1", actor, mode: "resume" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 410 });
  });
});
