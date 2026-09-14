import "server-only";

import type { ErrorsTranslator } from "@/lib/api/error-contract";
import {
  providerErrorText,
  type ProviderErrorDescription,
} from "@/server/ai/provider-error";

/**
 * A streaming turn's failure, as the two chat routes observe it.
 *
 * The AI SDK does not report every provider failure as
 * `outcome.status === "failed"` — a fatal stream error reaches `onEnd` as
 * `{ status: "unknown" }` — so both routes decide the turn outcome from what
 * they observed here instead. See `.trellis/spec/backend/error-handling.md`
 * for why, and for the retry/`RetryError` behaviour that shapes what arrives.
 */
export type StreamFailureTracker = {
  /**
   * Resolves a failure to the text the user ends up seeing, and records that
   * the turn failed. Wired into both the UI stream's error hook — which is what
   * puts our copy in front of the client instead of the SDK's own "An error
   * occurred." — and the outer stream's hook, which catches anything that
   * escapes the inner one.
   */
  describe: (error: unknown) => string;
  /** Whether any hook has observed a failure. */
  readonly sawFailure: boolean;
  /** The resolved text, or `null` while nothing has failed. */
  readonly message: string | null;
};

export function createStreamFailureTracker(
  describeError: (error: unknown) => ProviderErrorDescription,
  t: ErrorsTranslator,
): StreamFailureTracker {
  let sawFailure = false;
  let message: string | null = null;
  return {
    describe: (error: unknown): string => {
      sawFailure = true;
      // The same failure reaches both hooks, so the first resolution wins —
      // the text the row persists and the text the client receives are then
      // the same string by construction.
      if (message === null) {
        message = providerErrorText(describeError(error), t);
      }
      return message;
    },
    get sawFailure() {
      return sawFailure;
    },
    get message() {
      return message;
    },
  };
}
