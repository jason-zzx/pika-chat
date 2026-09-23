import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { APICallError, RetryError, streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { logger } from "@/server/logger";
import { AppError } from "@/server/errors";

import messages from "../../../messages/en.json";
import {
  clampErrorMessage,
  describeProviderError,
  extractProviderErrorField,
  providerErrorText,
  scrubSecret,
  scrubSecrets,
  type ProviderErrorDescription,
} from "./provider-error";

const t = createTranslator({ locale: "en", messages, namespace: "Errors" });

const SECRETS = { apiKey: "sk-leaked-key", baseUrl: "https://internal.test/v1" };

function apiError(options: {
  statusCode: number;
  responseBody?: string;
  data?: unknown;
}): APICallError {
  return new APICallError({
    message: "request failed",
    url: "https://internal.test/v1/chat/completions",
    requestBodyValues: {},
    statusCode: options.statusCode,
    responseBody: options.responseBody,
    data: options.data,
  });
}

/** Silences the expected error log without hiding it from assertions. */
function captureLog() {
  const log = vi.spyOn(logger, "error").mockImplementation(() => logger);
  return { log, restore: () => log.mockRestore() };
}

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

describe("scrubSecrets", () => {
  it("redacts an echoed bearer header", () => {
    expect(scrubSecrets('{"Authorization":"Bearer sk-other"}', SECRETS)).toBe(
      '{"Authorization":"Bearer [redacted]"}',
    );
  });

  it("redacts basic auth values", () => {
    expect(scrubSecrets("Basic dXNlcjpwYXNz", SECRETS)).toBe("Basic [redacted]");
  });

  it("redacts the configured base URL and its bare host", () => {
    const scrubbed = scrubSecrets(
      "POST https://internal.test/v1/chat/completions on internal.test",
      SECRETS,
    );
    expect(scrubbed).not.toContain("internal.test");
    expect(scrubbed).toContain("[redacted]");
  });

  it("redacts the value of a credential-named field even when it is not our key", () => {
    const error = apiError({
      statusCode: 400,
      responseBody: JSON.stringify({
        error: { message: "bad request", api_key: "sk-someone-else" },
      }),
    });
    const captured = captureLog();
    const message = verbatimMessage(describeProviderError(error, SECRETS));
    expect(message).not.toContain("sk-someone-else");
    expect(message).toContain("[redacted]");
    captured.restore();
  });
});

describe("extractProviderErrorField", () => {
  it("returns the whole error object, not just message and code", () => {
    expect(
      extractProviderErrorField({
        error: {
          message: "model does not exist",
          type: "invalid_request_error",
          param: "model",
          code: "model_not_found",
        },
      }),
    ).toEqual({
      message: "model does not exist",
      type: "invalid_request_error",
      param: "model",
      code: "model_not_found",
    });
  });

  it("ignores everything outside the error field", () => {
    expect(
      extractProviderErrorField({
        error: { message: "nope" },
        request: { Authorization: "Bearer sk-other" },
      }),
    ).toEqual({ message: "nope" });
  });

  it("is undefined when the body carries no error field", () => {
    expect(extractProviderErrorField({ detail: "bad gateway" })).toBeUndefined();
  });
});

describe("describeProviderError", () => {
  it("keeps the whole upstream error object and scrubs the key inside it", () => {
    const error = apiError({
      statusCode: 401,
      responseBody: JSON.stringify({
        error: {
          message: "invalid api key sk-leaked-key",
          type: "authentication_error",
          code: "invalid_api_key",
        },
      }),
    });

    const captured = captureLog();
    const described = describeProviderError(error, SECRETS);
    expect(described.code).toBe("PROVIDER_ERROR");

    const message = verbatimMessage(described);
    // Indented JSON, so the transcript's monospace block can render it.
    expect(message).toContain('"code": "invalid_api_key"');
    expect(message).toContain('"type": "authentication_error"');
    expect(message).not.toContain("sk-leaked-key");
    expect(JSON.stringify(captured.log.mock.calls[0]?.[0])).toContain(
      "[redacted]",
    );
    expect(JSON.stringify(captured.log.mock.calls[0]?.[0])).not.toContain(
      "sk-leaked-key",
    );
    captured.restore();
  });

  it("scrubs a request echo the gateway embedded in the error", () => {
    const error = apiError({
      statusCode: 400,
      responseBody: JSON.stringify({
        error: {
          message: "bad request",
          request: {
            Authorization: "Bearer sk-leaked-key",
            url: "https://internal.test/v1/chat/completions",
          },
        },
      }),
    });

    const captured = captureLog();
    const message = verbatimMessage(describeProviderError(error, SECRETS));
    expect(message).not.toContain("sk-leaked-key");
    expect(message).not.toContain("internal.test");
    captured.restore();
  });

  it("maps 429 to RATE_LIMITED and keeps the upstream body", () => {
    const error = apiError({
      statusCode: 429,
      responseBody: JSON.stringify({ error: { message: "quota exceeded" } }),
    });
    const captured = captureLog();
    expect(describeProviderError(error, SECRETS)).toMatchObject({
      code: "RATE_LIMITED",
      kind: "verbatim",
    });
    expect(verbatimMessage(describeProviderError(error, SECRETS))).toContain(
      "quota exceeded",
    );
    captured.restore();
  });

  it("falls back to the sanitized raw body when there is no error field", () => {
    const error = apiError({
      statusCode: 502,
      responseBody: "<html>502 Bad Gateway</html>",
    });
    const captured = captureLog();
    expect(describeProviderError(error, SECRETS)).toEqual({
      code: "PROVIDER_ERROR",
      kind: "verbatim",
      message: "<html>502 Bad Gateway</html>",
    });
    captured.restore();
  });

  it("falls back to our own key only when the provider said nothing at all", () => {
    const error = apiError({ statusCode: 401 });
    const captured = captureLog();
    expect(describeProviderError(error, SECRETS)).toEqual({
      code: "PROVIDER_ERROR",
      kind: "key",
      messageKey: "provider.credentialsRejected",
    });
    captured.restore();
  });

  it("maps a timeout to our own key without echoing the error object", () => {
    const error = new Error("aborted");
    error.name = "TimeoutError";
    const captured = captureLog();
    expect(describeProviderError(error, SECRETS)).toEqual({
      code: "PROVIDER_ERROR",
      kind: "key",
      messageKey: "provider.timedOut",
    });
    captured.restore();
  });

  it("passes our own AppError through with its catalog key", () => {
    // The image adapters throw AppError(provider.unexpectedResponse) when a
    // gateway answers 200 with an unparseable body; folding that into
    // "unreachable" misreports a malformed upstream answer as a network
    // failure.
    const captured = captureLog();
    expect(
      describeProviderError(
        new AppError("PROVIDER_ERROR", 500, "provider.unexpectedResponse"),
        SECRETS,
      ),
    ).toEqual({
      code: "PROVIDER_ERROR",
      kind: "key",
      messageKey: "provider.unexpectedResponse",
    });
    captured.restore();
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
  it("truncates a body long enough to bloat the row", () => {
    const clamped = clampErrorMessage("x".repeat(5000));
    expect(clamped.endsWith("…")).toBe(true);
    expect(clamped.length).toBe(4001);
  });

  it("keeps a realistically long provider error intact", () => {
    const body = JSON.stringify({
      error: { message: "m".repeat(600), code: "some_code" },
    });
    expect(clampErrorMessage(body).endsWith("…")).toBe(false);
  });
});

const GATEWAY_BODY = JSON.stringify({
  error: {
    code: "model_not_found",
    message: "No available channel for model gpt-5.6-luna under group default",
    type: "new_api_error",
  },
});

describe("describeProviderError given a retried failure", () => {
  // Regression: the retry wrapper throws `RetryError`, not the provider's
  // `APICallError`. Describing the wrapper reported our generic "unreachable"
  // copy — a 503 read as "cannot reach the provider" while the real body was
  // sitting in `lastError`.
  it("unwraps RetryError and shows the provider's own error", () => {
    const providerError = apiError({
      statusCode: 503,
      responseBody: GATEWAY_BODY,
    });
    const wrapped = new RetryError({
      message: "Failed after 3 attempts.",
      reason: "maxRetriesExceeded",
      errors: [providerError, providerError, providerError],
    });

    const captured = captureLog();
    const message = verbatimMessage(describeProviderError(wrapped, SECRETS));
    expect(message).toContain("No available channel for model gpt-5.6-luna");
    expect(message).toContain('"code": "model_not_found"');
    expect(message).toContain('"type": "new_api_error"');
    captured.restore();
  });

  it("is unchanged for an error that was never wrapped", () => {
    const captured = captureLog();
    expect(
      verbatimMessage(
        describeProviderError(
          apiError({ statusCode: 404, responseBody: GATEWAY_BODY }),
          SECRETS,
        ),
      ),
    ).toContain("No available channel for model gpt-5.6-luna");
    captured.restore();
  });
});

describe("describeProviderError against a real retried 503", () => {
  let requests = 0;
  const server = createServer((req, res) => {
    requests += 1;
    req.resume();
    req.on("end", () => {
      res.writeHead(503, {
        "content-type": "application/json",
        // Keeps the backoff at ~0ms so the test does not sit through the real
        // 2s pause; the retry path exercised is the same one.
        "retry-after-ms": "1",
      });
      res.end(GATEWAY_BODY);
    });
  });

  let baseURL = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });

  afterAll(() => {
    server.close();
  });

  it("describes the provider body, not the retry wrapper", async () => {
    requests = 0;
    const model = createOpenAICompatible({
      name: "hosted",
      baseURL,
      apiKey: "sk-test",
    }).chatModel("gpt-5.6-luna");

    const result = streamText({
      model,
      messages: [{ role: "user", content: "hi" }],
      maxRetries: 1,
    });

    let error: unknown;
    for await (const part of result.fullStream) {
      if (part.type === "error") {
        error = part.error;
      }
    }

    // The failure really did go through the retry path…
    expect(RetryError.isInstance(error)).toBe(true);
    expect(requests).toBe(2);

    // …and the user still gets what the gateway said.
    const captured = captureLog();
    const message = verbatimMessage(
      describeProviderError(error, { apiKey: "sk-test", baseUrl: baseURL }),
    );
    expect(message).toContain("No available channel for model gpt-5.6-luna");
    expect(message).toContain('"code": "model_not_found"');
    captured.restore();
  }, 30_000);
});
