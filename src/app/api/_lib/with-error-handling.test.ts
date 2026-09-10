import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";

import { withErrorHandling } from "./with-error-handling";

const schema = z.object({
  title: z.string().min(3),
  count: z.number(),
});

type Envelope = {
  error: {
    code: string;
    messageKey: string;
    params?: Record<string, string | number>;
    details?: {
      fieldErrors?: Record<string, { key: string; params?: Record<string, unknown> }>;
      requestId?: string;
    };
  };
};

async function errorBody(response: Response): Promise<Envelope> {
  return (await response.json()) as Envelope;
}

function request(): Request {
  return new Request("http://test.local/api/example", { method: "POST" });
}

describe("withErrorHandling", () => {
  it("passes successful responses through", async () => {
    const handler = withErrorHandling(async () => Response.json({ ok: true }));
    const response = await handler(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("maps a ZodError to VALIDATION_FAILED with per-field issue keys", async () => {
    const handler = withErrorHandling(async () => {
      schema.parse({ count: "nope" });
      return new Response(null, { status: 204 });
    });

    const response = await handler(request());
    expect(response.status).toBe(400);
    const body = await errorBody(response);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.messageKey).toBe("validation.failed");
    // Raw Zod English never reaches the wire.
    expect(JSON.stringify(body)).not.toContain("Invalid input");
    expect(body.error.details?.fieldErrors).toEqual({
      title: { key: "invalidType" },
      count: { key: "invalidType" },
    });
  });

  it("carries issue params for length violations", async () => {
    const handler = withErrorHandling(async () => {
      schema.parse({ title: "ab", count: 1 });
      return new Response(null, { status: 204 });
    });

    const body = await errorBody(await handler(request()));
    expect(body.error.details?.fieldErrors).toEqual({
      title: { key: "tooSmall", params: { minimum: 3 } },
    });
  });

  it("maps an AppError to its code, messageKey, params, and details", async () => {
    const handler = withErrorHandling(async () => {
      throw new AppError("PROVIDER_ERROR", 502, "provider.httpStatus", {
        status: 503,
      });
    });

    const response = await handler(request());
    expect(response.status).toBe(502);
    const body = await errorBody(response);
    expect(body.error).toMatchObject({
      code: "PROVIDER_ERROR",
      messageKey: "provider.httpStatus",
      params: { status: 503 },
    });
    expect(body.error).not.toHaveProperty("message");
  });

  it("maps unrecognized throwables to INTERNAL with a request id", async () => {
    const log = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const handler = withErrorHandling(async () => {
      throw new Error("boom");
    });

    const response = await handler(request());
    expect(response.status).toBe(500);
    const body = await errorBody(response);
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.messageKey).toBe("unexpected");
    expect(typeof body.error.details?.requestId).toBe("string");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
