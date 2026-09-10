import type {
  AppErrorMessageKey,
  ErrorMessageParams,
  ErrorsTranslator,
} from "@/lib/api/error-contract";

type ParsedApiError = {
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
  return { messageKey, params: parseParams(wrapped["params"]) };
}

function asDynamic(t: ErrorsTranslator): DynamicTranslator {
  return t as DynamicTranslator;
}

/**
 * Resolves a thrown API error to display text.
 *
 * `t` is the caller's `useTranslations("Errors")`. A known `messageKey` is
 * resolved with its params; an unknown key falls back to the localized
 * `generic` entry; anything that is not our envelope falls back to the
 * caller's action-specific key.
 */
export function apiErrorMessage(
  error: unknown,
  t: ErrorsTranslator,
  fallbackKey: AppErrorMessageKey,
): string {
  const parsed = parseApiError(error);
  if (parsed === undefined) {
    return t(fallbackKey);
  }
  const dynamic = asDynamic(t);
  return dynamic.has(parsed.messageKey)
    ? dynamic(parsed.messageKey, parsed.params)
    : dynamic("generic");
}
