import "server-only";

import { APICallError } from "ai";

import type { AppErrorCode } from "@/server/errors";
import { logger } from "@/server/logger";

const MAX_MESSAGE_LENGTH = 400;

export function scrubSecret(text: string, secret: string): string {
  return secret.length === 0 ? text : text.replaceAll(secret, "[redacted]");
}

export function clampErrorMessage(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_MESSAGE_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_MESSAGE_LENGTH)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function extractStructuredProviderMessage(
  payload: unknown,
): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const errorField = payload.error;
  if (typeof errorField === "string" && errorField.length > 0) {
    return errorField;
  }
  if (isRecord(errorField)) {
    const message =
      typeof errorField.message === "string" ? errorField.message : undefined;
    const code = typeof errorField.code === "string" ? errorField.code : undefined;
    if (message && code) {
      return `${code}: ${message}`;
    }
    if (message) {
      return message;
    }
    if (code) {
      return code;
    }
  }

  if (typeof payload.message === "string" && payload.message.length > 0) {
    return payload.message;
  }
  return undefined;
}

function parseJsonBody(body: string | undefined): unknown {
  if (!body) {
    return undefined;
  }
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function fallbackForStatus(
  status: number | undefined,
): { code: AppErrorCode; message: string } {
  if (status === 401 || status === 403) {
    return { code: "PROVIDER_ERROR", message: "Provider rejected the credentials" };
  }
  if (status === 404) {
    return { code: "PROVIDER_ERROR", message: "Model not found" };
  }
  if (status === 429) {
    return { code: "RATE_LIMITED", message: "Provider rate limit reached" };
  }
  return { code: "PROVIDER_ERROR", message: "Provider request failed" };
}

function isTimeoutError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

export function describeProviderError(
  error: unknown,
  apiKey: string,
): { code: AppErrorCode; message: string } {
  let status: number | undefined;
  let responseBody: string | undefined;
  let data: unknown;

  if (APICallError.isInstance(error)) {
    status = error.statusCode;
    responseBody = error.responseBody;
    data = error.data;
  }

  logger.error(
    {
      statusCode: status,
      responseBody: responseBody
        ? scrubSecret(responseBody, apiKey)
        : undefined,
    },
    "provider call failed",
  );

  if (!APICallError.isInstance(error)) {
    if (isTimeoutError(error)) {
      return { code: "PROVIDER_ERROR", message: "Provider request timed out" };
    }
    return { code: "PROVIDER_ERROR", message: "Unable to reach the provider" };
  }

  const payload = data ?? parseJsonBody(responseBody);
  const extracted = extractStructuredProviderMessage(payload);
  const fallback = fallbackForStatus(status);
  const message = clampErrorMessage(scrubSecret(extracted ?? fallback.message, apiKey));
  if (message.length === 0) {
    return fallback;
  }
  return { code: fallback.code, message };
}
