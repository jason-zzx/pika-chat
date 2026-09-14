import type {
  AppErrorMessageKey,
  ErrorMessageParams,
  ErrorsTranslator,
} from "@/lib/api/error-contract";

type ParsedApiError = {
  code?: string;
  messageKey: string;
  params?: ErrorMessageParams;
};

/**
 * A widened view of a catalog translator for wire-supplied keys.
 *
 * next-intl types `t`/`t.has` against the literal catalog keys, while the key
 * that arrives in a response body is a plain `string`. `has` is next-intl's own
 * runtime lookup, so it stays the source of truth for "this key exists in the
 * active catalog"; the widening below only restores the literal type the call
 * needs. This is the single sanctioned dynamic-key narrowing (see
 * `.trellis/spec/frontend/i18n.md`).
 */
type DynamicTranslator = {
  (key: string, params?: ErrorMessageParams): string;
  has: (key: string) => boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseParams(value: unknown): ErrorMessageParams | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const params: ErrorMessageParams = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" || typeof entry === "number") {
      params[key] = entry;
    }
  }
  return Object.keys(params).length > 0 ? params : undefined;
}

/**
 * Reads the `{ error: { messageKey, params? } }` envelope thrown by the API
 * clients. Anything else (network failure, unexpected shape) returns
 * `undefined` and the caller falls back to an action-specific message.
 */
function parseApiError(error: unknown): ParsedApiError | undefined {
  if (!isRecord(error)) {
    return undefined;
  }
  const wrapped = error["error"];
  if (!isRecord(wrapped)) {
    return undefined;
  }
  const messageKey = wrapped["messageKey"];
  if (typeof messageKey !== "string" || messageKey.length === 0) {
    return undefined;
  }
  const code = wrapped["code"];
  return {
    code: typeof code === "string" && code.length > 0 ? code : undefined,
    messageKey,
    params: parseParams(wrapped["params"]),
  };
}

function asDynamic(t: ErrorsTranslator): DynamicTranslator {
  return t as DynamicTranslator;
}

/**
 * Parses a raw response body that may carry our envelope as JSON text. The
 * AI SDK's `useChat` throws `new Error(await response.text())`, so the envelope
 * reaches the client as a string rather than an object.
 */
function parseEnvelopeString(value: string): ParsedApiError | undefined {
  const trimmed = value.trim();
  // Cheap rejection for the overwhelmingly common non-JSON network error
  // before paying for `JSON.parse` on arbitrary text.
  if (!trimmed.startsWith("{")) {
    return undefined;
  }
  try {
    return parseApiError(JSON.parse(trimmed));
  } catch {
    return undefined;
  }
}

/**
 * Extracts our envelope from every shape an API client can throw: the parsed
 * envelope object, a raw JSON body string, or an `Error` whose message carries
 * that body. Anything else returns `undefined`.
 */
function parseApiErrorFromUnknown(error: unknown): ParsedApiError | undefined {
  const direct = parseApiError(error);
  if (direct !== undefined) {
    return direct;
  }
  if (typeof error === "string") {
    return parseEnvelopeString(error);
  }
  if (error instanceof Error) {
    return parseEnvelopeString(error.message);
  }
  return undefined;
}

/**
 * The envelope's machine-readable `code` (e.g. `CONFLICT`), extracted from any
 * shape an API client can throw. `undefined` for non-envelope errors.
 */
export function apiErrorCode(error: unknown): string | undefined {
  return parseApiErrorFromUnknown(error)?.code;
}

/**
 * Resolves a thrown API error to display text, including the raw response body
 * the AI SDK wraps in `Error.message`.
 *
 * `t` is the caller's `useTranslations("Errors")`. A known `messageKey` is
 * resolved with its params; an unknown key falls back to the localized
 * `generic` entry; anything that is not our envelope falls back to the
 * caller's action-specific key. This is the single owner of the resolution
 * path — every other entry point delegates here.
 */
export function apiErrorMessageFromUnknown(
  error: unknown,
  t: ErrorsTranslator,
  fallbackKey: AppErrorMessageKey,
): string {
  const parsed = parseApiErrorFromUnknown(error);
  if (parsed === undefined) {
    return t(fallbackKey);
  }
  const dynamic = asDynamic(t);
  return dynamic.has(parsed.messageKey)
    ? dynamic(parsed.messageKey, parsed.params)
    : dynamic("generic");
}

/** Alias kept for call sites that already hold a parsed envelope or an
 * arbitrary object; `apiErrorMessageFromUnknown` is the owner of the logic. */
export function apiErrorMessage(
  error: unknown,
  t: ErrorsTranslator,
  fallbackKey: AppErrorMessageKey,
): string {
  return apiErrorMessageFromUnknown(error, t, fallbackKey);
}
