import "server-only";

import type { AvailableModel } from "@/lib/schemas/provider";
import {
  createChatModelHandle,
  type ChatModelHandle,
} from "@/server/ai/chat-model";
import { resolveAvailableModels } from "@/server/ai/model-resolution";
import type { Actor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";

export type SelectedChatModel = {
  /** The resolved catalog entry (context window, modalities, output budget). */
  selected: AvailableModel;
  handle: ChatModelHandle;
};

/**
 * The single availability gate for a caller-supplied (config, model) pair:
 * resolves it against the models the caller may actually use and builds the
 * handle, throwing `model.notAvailable` otherwise. Shared by /api/chat, the
 * regenerate route, and manual compression so the three agree on what "usable
 * model" means (PRD R6 — the summary model is the session's own model).
 */
export async function requireModelForActor(
  pair: { providerConfigId: string; modelId: string },
  actor: Actor,
  options?: { builtinSearch?: boolean },
): Promise<SelectedChatModel> {
  const available = await resolveAvailableModels(actor);
  const selected = available.find(
    (model) =>
      model.configId === pair.providerConfigId && model.modelId === pair.modelId,
  );
  if (!selected) {
    throw new AppError("VALIDATION_FAILED", 400, "model.notAvailable");
  }
  const handle = await createChatModelHandle(pair, actor, options);
  return { selected, handle };
}
