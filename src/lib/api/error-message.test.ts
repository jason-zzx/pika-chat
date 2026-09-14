import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import { apiErrorMessage, apiErrorMessageFromUnknown, isApiErrorEnvelope } from "@/lib/api/error-message";

import enMessages from "../../../messages/en.json";
import zhMessages from "../../../messages/zh-CN.json";

const en = createTranslator({ locale: "en", messages: enMessages, namespace: "Errors" });
const zh = createTranslator({
  locale: "zh-CN",
  messages: zhMessages,
  namespace: "Errors",
});

describe("apiErrorMessage", () => {
  it("resolves a known message key with its params in the active locale", () => {
    const error = {
      error: {
        code: "PROVIDER_ERROR",
        messageKey: "provider.httpStatus",
        params: { status: 502 },
      },
    };

    expect(apiErrorMessage(error, en, "actions.loadProviders")).toBe(
      "Provider returned HTTP 502",
    );
    expect(apiErrorMessage(error, zh, "actions.loadProviders")).toBe(
      "服务商返回 HTTP 502",
    );
  });

  it("falls back to the localized generic message for an unknown key", () => {
    const error = { error: { code: "INTERNAL", messageKey: "gone.missing" } };

    expect(apiErrorMessage(error, en, "actions.loadProviders")).toBe(
      "Something went wrong. Please try again.",
    );
    expect(apiErrorMessage(error, zh, "actions.loadProviders")).toBe(
      "出错了，请重试。",
    );
  });

  it("uses the action fallback for anything that is not our envelope", () => {
    expect(apiErrorMessage(new Error("network down"), en, "actions.loadProviders")).toBe(
      "Unable to load providers",
    );
    expect(apiErrorMessage(null, en, "actions.loadProviders")).toBe(
      "Unable to load providers",
    );
    expect(apiErrorMessage({ error: { code: "INTERNAL" } }, en, "actions.loadProviders")).toBe(
      "Unable to load providers",
    );
  });

  it("ignores non-scalar params instead of leaking raw values", () => {
    const error = {
      error: {
        code: "VALIDATION_FAILED",
        messageKey: "validation.failed",
        params: { nested: { secret: "x" }, ok: 1 },
      },
    };

    expect(apiErrorMessage(error, en, "actions.loadProviders")).toBe(
      "Invalid request",
    );
  });
});

describe("apiErrorMessageFromUnknown", () => {
  it("parses a raw JSON response body string", () => {
    const body = JSON.stringify({
      error: {
        code: "VALIDATION_FAILED",
        messageKey: "file.tooLarge",
        params: { limit: "20 MB" },
      },
    });

    expect(
      apiErrorMessageFromUnknown(body, en, "actions.sendMessage"),
    ).toBe("File is larger than the 20 MB limit");
    expect(
      apiErrorMessageFromUnknown(body, zh, "actions.sendMessage"),
    ).toBe("文件超过 20 MB 上限");
  });

  it("parses an Error whose message carries the JSON body", () => {
    // The AI SDK throws `new Error(await response.text())`.
    const error = new Error(
      JSON.stringify({
        error: { code: "VALIDATION_FAILED", messageKey: "file.noTextLayer" },
      }),
    );

    expect(
      apiErrorMessageFromUnknown(error, en, "actions.sendMessage"),
    ).toBe(
      "This file has no extractable text; use a model that supports it natively",
    );
  });

  it("resolves an already-parsed envelope object", () => {
    const error = {
      error: { code: "CONFLICT", messageKey: "file.inUse" },
    };

    expect(
      apiErrorMessageFromUnknown(error, en, "actions.sendMessage"),
    ).toBe("This file is still used by a message");
  });

  it("falls back for a non-JSON network error string", () => {
    expect(
      apiErrorMessageFromUnknown(
        "Failed to fetch",
        en,
        "actions.sendMessage",
      ),
    ).toBe("Unable to send the message");
    expect(
      apiErrorMessageFromUnknown(
        new Error("Failed to fetch"),
        zh,
        "actions.sendMessage",
      ),
    ).toBe("无法发送消息");
  });

  it("falls back to the generic entry for an unknown message key", () => {
    const error = JSON.stringify({
      error: { code: "INTERNAL", messageKey: "gone.missing" },
    });

    expect(
      apiErrorMessageFromUnknown(error, en, "actions.sendMessage"),
    ).toBe("Something went wrong. Please try again.");
  });
});

// Distinguishes "the request failed before a stream opened" (our envelope) from
// "the stream failed" (the sanitized provider detail). The composer banner is
// for the former; the transcript owns the latter.
describe("isApiErrorEnvelope", () => {
  it("is true for our envelope, however it was thrown", () => {
    const envelope = { error: { code: "NOT_FOUND", messageKey: "topic.notFound" } };
    expect(isApiErrorEnvelope(envelope)).toBe(true);
    expect(isApiErrorEnvelope(JSON.stringify(envelope))).toBe(true);
    expect(isApiErrorEnvelope(new Error(JSON.stringify(envelope)))).toBe(true);
  });

  it("is false for a sanitized provider payload", () => {
    // The shape `describeProviderError` persists for an upstream error.
    const payload = JSON.stringify(
      { message: "No available channel for model x", code: "model_not_found" },
      null,
      2,
    );
    expect(isApiErrorEnvelope(new Error(payload))).toBe(false);
  });

  it("is false for a network error", () => {
    expect(isApiErrorEnvelope(new TypeError("fetch failed"))).toBe(false);
  });
});
