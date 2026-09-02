import { APICallError } from "ai";
import { describe, expect, it, vi } from "vitest";

import { logger } from "@/server/logger";

import {
  clampErrorMessage,
  describeProviderError,
  extractStructuredProviderMessage,
  scrubSecret,
} from "./provider-error";

describe("scrubSecret", () => {
  it("removes every occurrence of the key", () => {
    expect(scrubSecret("bad key sk-secret in body sk-secret", "sk-secret")).toBe(
      "bad key [redacted] in body [redacted]",
    );
  });

  it("leaves text unchanged when the secret is empty", () => {
    expect(scrubSecret("hello", "")).toBe("hello");
  });
});

describe("extractStructuredProviderMessage", () => {
  it("reads error.message and error.code", () => {
    expect(
      extractStructuredProviderMessage({
        error: { message: "model does not exist", code: "model_not_found" },
      }),
    ).toBe("model_not_found: model does not exist");
  });

  it("does not return the raw body when structured fields are absent", () => {
    expect(
      extractStructuredProviderMessage({
        raw: "Authorization: Bearer sk-leaked",
      }),
    ).toBeUndefined();
  });
});

describe("describeProviderError", () => {
  it("scrubs a key embedded in the upstream error message", () => {
    const error = new APICallError({
      message: "Unauthorized",
      url: "https://example.com/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 401,
      responseBody: JSON.stringify({
        error: { message: "invalid api key sk-leaked-key", code: "invalid_api_key" },
      }),
    });

    const log = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const described = describeProviderError(error, "sk-leaked-key");
    expect(described.code).toBe("PROVIDER_ERROR");
    expect(described.message).toContain("invalid_api_key");
    expect(described.message).not.toContain("sk-leaked-key");
    expect(JSON.stringify(log.mock.calls[0]?.[0])).toContain("[redacted]");
    expect(JSON.stringify(log.mock.calls[0]?.[0])).not.toContain("sk-leaked-key");
    log.mockRestore();
  });

  it("maps 429 to RATE_LIMITED", () => {
    const error = new APICallError({
      message: "Too many requests",
      url: "https://example.com/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 429,
      responseBody: JSON.stringify({ error: { message: "quota exceeded" } }),
    });
    expect(describeProviderError(error, "sk-x")).toMatchObject({
      code: "RATE_LIMITED",
      message: "quota exceeded",
    });
  });

  it("maps a timeout without echoing the error object", () => {
    const error = new Error("aborted");
    error.name = "TimeoutError";
    expect(describeProviderError(error, "sk-x")).toEqual({
      code: "PROVIDER_ERROR",
      message: "Provider request timed out",
    });
  });
});

describe("clampErrorMessage", () => {
  it("truncates long messages", () => {
    const long = "x".repeat(500);
    const clamped = clampErrorMessage(long);
    expect(clamped.endsWith("…")).toBe(true);
    expect(clamped.length).toBeLessThanOrEqual(401);
  });
});
