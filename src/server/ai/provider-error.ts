import "server-only";

import { APICallError, RetryError } from "ai";

import type {
  AppErrorCode,
  AppErrorMessageKey,
  ErrorMessageParams,
  ErrorsTranslator,
} from "@/lib/api/error-contract";
import { logger } from "@/server/logger";
import { AppError } from "@/server/errors";

/**
 * Hard ceiling on stored error text. The transcript renders it inside a
 * height-capped, scrollable container, so this only exists to stop a
 * pathological upstream body from bloating the row and every history payload
 * that carries it.
 */
const MAX_MESSAGE_LENGTH = 4000;

const REDACTED = "[redacted]";

/**
 * Credentials an upstream error body might have echoed back at us. A gateway
 * that echoes the request can hand us the owner's key or internal endpoint,
 * and provider configs are `shared` — user B may drive admin A's config — so
 * every string we lift out of a response body passes through this first.
 */
export type ProviderErrorSecrets = {
  /** Plaintext API key, scrubbed wherever it appears. */
  apiKey?: string;
  /** Configured base URL, scrubbed so a shared config's endpoint does not leak. */
  baseUrl?: string;
};

/**
 * A provider failure description.
 *
 * Our own wrapper copy is a catalog key (`kind: "key"`) resolved to the
 * request locale at the transport boundary; anything lifted from an upstream
 * response stays verbatim (`kind: "verbatim"`) — it is third-party output we
 * must neither translate nor paraphrase.
 */
export type ProviderErrorDescription =
  | {
      code: AppErrorCode;
      kind: "key";
      messageKey: AppErrorMessageKey;
      params?: ErrorMessageParams;
    }
  | { code: AppErrorCode; kind: "verbatim"; message: string };

export function providerErrorText(
  description: ProviderErrorDescription,
  t: ErrorsTranslator,
): string {
  return description.kind === "key"
    ? t(description.messageKey, description.params)
    : description.message;
}

export function scrubSecret(text: string, secret: string): string {
  return secret.length === 0 ? text : text.replaceAll(secret, REDACTED);
}

/** `Bearer …` / `Basic …` header values, in prose or inside a JSON string. */
const AUTH_VALUE_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;

/**
 * Keys whose entire value is a credential regardless of what it looks like —
 * an echoed header, or another tenant's key that would not match ours.
 */
const SECRET_KEY_PATTERN =
  /^(?:authorization|proxy-authorization|x-api-key|api[-_]?key)$/i;

/** Redacts every credential shape we know how to recognise in one string. */
export function scrubSecrets(
  text: string,
  secrets: ProviderErrorSecrets,
): string {
  let scrubbed = scrubSecret(text, secrets.apiKey ?? "");
  scrubbed = scrubbed.replace(
    AUTH_VALUE_PATTERN,
    (_match, scheme: string) => `${scheme} ${REDACTED}`,
  );

  const baseUrl = secrets.baseUrl?.replace(/\/+$/, "");
  if (baseUrl) {
    scrubbed = scrubSecret(scrubbed, baseUrl);
    // The host also appears on its own, e.g. in an echoed `url` field.
    try {
      scrubbed = scrubSecret(scrubbed, new URL(baseUrl).host);
    } catch {
      // A malformed configured base URL must not fail the error path.
    }
  }
  return scrubbed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Scrubs every string in a parsed JSON payload, at any depth. */
function scrubValue(value: unknown, secrets: ProviderErrorSecrets): unknown {
  if (typeof value === "string") {
    return scrubSecrets(value, secrets);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => scrubValue(entry, secrets));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SECRET_KEY_PATTERN.test(key) ? REDACTED : scrubValue(entry, secrets),
      ]),
    );
  }
  return value;
}

/**
 * The upstream `error` field, in whichever shape the gateway used: the
 * standard OpenAI `{ message, type, param, code }` object, a plain string, or
 * an array.
 *
 * Only this field is taken. A gateway that echoes the request puts the echoed
 * body elsewhere in the response, so narrowing to `error` — rather than
 * shipping the whole body — keeps the echo out without having to enumerate
 * every place a credential could hide.
 */
export function extractProviderErrorField(payload: unknown): unknown {
  return isRecord(payload) ? payload.error : undefined;
}

/**
 * Renders an extracted `error` field for display: objects become indented JSON
 * (the transcript shows it in a monospace, scrollable block), strings pass
 * through.
 */
function formatProviderErrorField(
  field: unknown,
  secrets: ProviderErrorSecrets,
): string {
  const scrubbed = scrubValue(field, secrets);
  if (typeof scrubbed === "string") {
    return scrubbed;
  }
  return JSON.stringify(scrubbed, null, 2) ?? "";
}

export function clampErrorMessage(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_MESSAGE_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_MESSAGE_LENGTH)}…`;
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

function fallbackForStatus(status: number | undefined): {
  code: AppErrorCode;
  messageKey: AppErrorMessageKey;
} {
  if (status === 401 || status === 403) {
    return { code: "PROVIDER_ERROR", messageKey: "provider.credentialsRejected" };
  }
  if (status === 404) {
    return { code: "PROVIDER_ERROR", messageKey: "model.notFound" };
  }
  if (status === 429) {
    return { code: "RATE_LIMITED", messageKey: "provider.rateLimited" };
  }
  return { code: "PROVIDER_ERROR", messageKey: "provider.requestFailed" };
}

function isTimeoutError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

/**
 * Reaches the provider error inside the SDK's retry wrapper.
 *
 * Any 408/409/429/5xx is retryable by default, and once the attempts are spent
 * the SDK throws a `RetryError` instead of the provider's error — the
 * `APICallError`, carrying the status code and the response body, survives
 * only in `lastError`. Describing the wrapper would report our generic
 * "unreachable" copy for what is really a provider answer with a body we can
 * show, so unwrap before describing.
 */
function unwrapRetryError(error: unknown): unknown {
  return RetryError.isInstance(error) ? (error.lastError ?? error) : error;
}

export function describeProviderError(
  error: unknown,
  secrets: ProviderErrorSecrets,
): ProviderErrorDescription {
  const failure = unwrapRetryError(error);
  let status: number | undefined;
  let responseBody: string | undefined;
  let data: unknown;

  if (APICallError.isInstance(failure)) {
    status = failure.statusCode;
    responseBody = failure.responseBody;
    data = failure.data;
  }

  logger.error(
    {
      statusCode: status,
      responseBody: responseBody
        ? scrubSecrets(responseBody, secrets)
        : undefined,
    },
    "provider call failed",
  );

  if (!APICallError.isInstance(failure)) {
    // Our own typed errors (e.g. `provider.unexpectedResponse` from the image
    // adapters when a gateway answers 200 with an unparseable body) carry
    // their catalog key through verbatim — folding them into "unreachable"
    // misreports a successful-but-malformed upstream answer as a network
    // failure.
    if (failure instanceof AppError) {
      return {
        code: failure.code,
        kind: "key",
        messageKey: failure.messageKey,
        ...(failure.params ? { params: failure.params } : {}),
      };
    }
    if (isTimeoutError(failure)) {
      return {
        code: "PROVIDER_ERROR",
        kind: "key",
        messageKey: "provider.timedOut",
      };
    }
    return {
      code: "PROVIDER_ERROR",
      kind: "key",
      messageKey: "provider.unreachable",
    };
  }

  const fallback = fallbackForStatus(status);
  const payload = data ?? parseJsonBody(responseBody);
  const errorField = extractProviderErrorField(payload);
  // A gateway that returns something other than a structured `error` — an
  // HTML error page, a bare string — still says more than our generic copy,
  // so the (scrubbed) body itself is the fallback. Only an empty body leaves
  // us with nothing but our own catalog key.
  const text =
    errorField === undefined || errorField === null
      ? scrubSecrets(responseBody ?? "", secrets)
      : formatProviderErrorField(errorField, secrets);
  const message = clampErrorMessage(text);
  if (message.length === 0) {
    return { code: fallback.code, kind: "key", messageKey: fallback.messageKey };
  }
  return { code: fallback.code, kind: "verbatim", message };
}
