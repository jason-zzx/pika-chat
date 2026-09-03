import "server-only";

import { AppError } from "@/server/errors";

export function resolvedReasoningEffort(
  model: { reasoning: boolean; reasoningOptions: string[] },
  requested: string | undefined,
): string | undefined {
  if (requested === undefined) {
    return undefined;
  }
  if (!model.reasoning || !model.reasoningOptions.includes(requested)) {
    throw new AppError(
      "VALIDATION_FAILED",
      400,
      "Selected reasoning effort is not available",
    );
  }
  return requested;
}
