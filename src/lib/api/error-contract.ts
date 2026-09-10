import type { _Translator, MessageKeys, Messages, NestedKeyOf } from "next-intl";

/** Every supported issues-per-field key of the `Validation` catalog. */
type CatalogKeys<T> = MessageKeys<T, NestedKeyOf<T>>;

/**
 * Stable, machine-readable error codes. Clients branch on `code`; they never
 * branch on the display text, which is localized per request.
 */
export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "INTERNAL";

/** ICU interpolation values inside the `Errors` catalog. */
export type ErrorMessageParams = Record<string, string | number>;

/**
 * Wire key of an `Errors` entry, relative to the `Errors` namespace:
 * `"topic.notFound"`, `"provider.httpStatus"`, `"generic"`, … Derived from the
 * catalog, so server throw sites are compile-checked against real keys.
 */
export type AppErrorMessageKey = CatalogKeys<Messages["Errors"]>;

/**
 * Wire key of a `Validation` entry, relative to the `Validation` namespace.
 * Derived from the catalog the same way `AppErrorMessageKey` is.
 */
export type ValidationIssueKey = CatalogKeys<Messages["Validation"]>;

/** Per-field validation detail carried in `error.details.fieldErrors` (R5). */
export type ValidationFieldError = {
  key: ValidationIssueKey;
  params?: ErrorMessageParams;
};

/**
 * The translator as returned by `useTranslations("Errors")` (client) or
 * `getTranslations({ namespace: "Errors" })` (server); the literal-key variant
 * so call sites stay type-checked.
 */
export type ErrorsTranslator = _Translator<Messages, "Errors">;

/**
 * The single failure shape every Route Handler returns via
 * `withErrorHandling` (see `.trellis/spec/backend/error-handling.md`).
 */
export type ApiErrorEnvelope = {
  error: {
    code: AppErrorCode;
    messageKey: string;
    params?: ErrorMessageParams;
    details?: unknown;
  };
};
