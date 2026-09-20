import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/errors";

const { requireActor, translateMessage } = vi.hoisted(() => ({
  requireActor: vi.fn(),
  translateMessage: vi.fn(),
}));

vi.mock("@/server/auth/actor", () => ({ requireActor }));
vi.mock("@/server/services/translation.service", () => ({ translateMessage }));
vi.mock("@/server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from "./route";

const ACTOR = { userId: "user-1", role: "user" as const };

function translateRequest(body: unknown): Request {
  return new Request("http://localhost/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  messageId: "m-1",
  targetLang: "en",
  providerConfigId: "cfg-1",
  modelId: "gpt-4o",
};

beforeEach(() => {
  vi.clearAllMocks();
  requireActor.mockResolvedValue(ACTOR);
  translateMessage.mockResolvedValue({ translation: "Hello" });
});

describe("POST /api/translate", () => {
  it("returns the translation for a valid request", async () => {
    const response = await POST(translateRequest(VALID_BODY));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ translation: "Hello" });
    expect(translateMessage).toHaveBeenCalledWith(VALID_BODY, ACTOR);
  });

  it("accepts a request without a model pair (the server resolves the preference)", async () => {
    const noPair = { messageId: "m-1", targetLang: "en" };
    const response = await POST(translateRequest(noPair));

    expect(response.status).toBe(200);
    expect(translateMessage).toHaveBeenCalledWith(noPair, ACTOR);
  });

  it("rejects an unlisted target language with VALIDATION_FAILED", async () => {
    const response = await POST(
      translateRequest({ ...VALID_BODY, targetLang: "pt" }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { code: string; messageKey: string };
    };
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.messageKey).toBe("validation.failed");
    expect(translateMessage).not.toHaveBeenCalled();
  });

  it("rejects a missing messageId", async () => {
    const response = await POST(
      translateRequest({ ...VALID_BODY, messageId: "" }),
    );

    expect(response.status).toBe(400);
    expect(translateMessage).not.toHaveBeenCalled();
  });

  it("maps service AppErrors onto the error envelope", async () => {
    translateMessage.mockRejectedValue(
      new AppError("NOT_FOUND", 404, "message.notFound"),
    );

    const response = await POST(translateRequest(VALID_BODY));

    expect(response.status).toBe(404);
    const body = (await response.json()) as {
      error: { code: string; messageKey: string };
    };
    expect(body.error).toMatchObject({
      code: "NOT_FOUND",
      messageKey: "message.notFound",
    });
  });

  it("requires authentication", async () => {
    requireActor.mockRejectedValue(
      new AppError("UNAUTHENTICATED", 401, "auth.required"),
    );

    const response = await POST(translateRequest(VALID_BODY));

    expect(response.status).toBe(401);
    expect(translateMessage).not.toHaveBeenCalled();
  });
});
