import "server-only";

import type {
  AppErrorCode,
  AppErrorMessageKey,
  ErrorMessageParams,
} from "@/lib/api/error-contract";

/**
 * How services signal a failure to the transport boundary.
 *
 * The display text is never carried here: `messageKey` (+ `params`) is a
 * stable key into the `Errors` catalog, resolved and localized by the client
 * (`.trellis/spec/backend/error-handling.md`, spec/frontend/i18n.md).
 */
export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    readonly status: number,
    readonly messageKey: AppErrorMessageKey,
    readonly params?: ErrorMessageParams,
    readonly details?: unknown,
  ) {
    super(messageKey);
    this.name = "AppError";
  }
}
