import { APICallError } from "ai";
import { createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import { logger } from "@/server/logger";

import messages from "../../../messages/en.json";
import {
  clampErrorMessage,
  describeProviderError,
  extractStructuredProviderMessage,
  providerErrorText,
  scrubSecret,
  type ProviderErrorDescription,
} from "./provider-error";

const t = createTranslator({ locale: "en", messages, namespace: "Errors" });

function verbatimMessage(description: ProviderErrorDescription): string {
  if (description.kind !== "verbatim") {
    throw new Error(`expected a verbatim description, got ${description.kind}`);
  }
  return description.message;
}

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
    // Upstream detail stays verbatim; only the key is scrubbed.
    const message = verbatimMessage(described);
    expect(message).toContain("invalid_api_key");
    expect(message).not.toContain("sk-leaked-key");
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
      kind: "verbatim",
      message: "quota exceeded",
    });
  });

  it("maps a timeout to our own key without echoing the error object", () => {
    const error = new Error("aborted");
    error.name = "TimeoutError";
    expect(describeProviderError(error, "sk-x")).toEqual({
      code: "PROVIDER_ERROR",
      kind: "key",
      messageKey: "provider.timedOut",
    });
  });

  it("falls back to a key when the provider sends nothing structured", () => {
    const error = new APICallError({
      message: "Unauthorized",
      url: "https://example.com/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 401,
      responseBody: "not json",
    });
    expect(describeProviderError(error, "sk-x")).toEqual({
      code: "PROVIDER_ERROR",
      kind: "key",
      messageKey: "provider.credentialsRejected",
    });
  });
});

describe("providerErrorText", () => {
  it("resolves our wrapper copy through the catalog", () => {
    expect(
      providerErrorText(
        {
          code: "PROVIDER_ERROR",
          kind: "key",
          messageKey: "provider.httpStatus",
          params: { status: 500 },
        },
        t,
      ),
    ).toBe("Provider returned HTTP 500");
  });

  it("passes upstream detail through verbatim", () => {
    expect(
      providerErrorText(
        { code: "PROVIDER_ERROR", kind: "verbatim", message: "upstream says no" },
        t,
      ),
    ).toBe("upstream says no");
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
