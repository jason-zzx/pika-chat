import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import { apiErrorMessage } from "@/lib/api/error-message";

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
