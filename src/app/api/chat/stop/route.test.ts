import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Stop is idempotent by contract: a double tap, a stale tab, or a stop that
 * races the turn's own completion must all leave the UI in the stopped state
 * rather than surfacing an error.
 */

const { requireActor, stopGenerationById } = vi.hoisted(() => ({
  requireActor: vi.fn(),
  stopGenerationById: vi.fn(),
}));

vi.mock("@/server/auth/actor", () => ({ requireActor }));
vi.mock("@/server/ai/generation-runner", () => ({ stopGenerationById }));

const { POST } = await import("./route");

const actor = { userId: "user-1", role: "user" as const };

function call(body: unknown = { streamId: "gen-1" }) {
  return POST(
    new Request("http://localhost/api/chat/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  requireActor.mockResolvedValue(actor);
  stopGenerationById.mockResolvedValue(undefined);
});

describe("POST /api/chat/stop", () => {
  it("stops the generation named by the legacy streamId field", async () => {
    const response = await call();

    expect(response.status).toBe(204);
    expect(stopGenerationById).toHaveBeenCalledWith("gen-1", actor);
  });

  it("is a success even when the turn already finished", async () => {
    // The runner treats unknown/terminal ids as a no-op; the route must not
    // convert that into an error the client would show.
    stopGenerationById.mockResolvedValue(undefined);
    expect((await call()).status).toBe(204);
  });

  it("rejects a body without a stream id", async () => {
    expect((await call({})).status).toBe(400);
    expect(stopGenerationById).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const { AppError } = await import("@/server/errors");
    requireActor.mockRejectedValue(
      new AppError("UNAUTHENTICATED", 401, "auth.required"),
    );
    expect((await call()).status).toBe(401);
  });
});
