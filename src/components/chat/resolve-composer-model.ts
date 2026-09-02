import type { ComposerModelPick } from "@/stores/composer-store";

import { sameModelPick } from "./model-pick";

type ResolveComposerModelInput = {
  topicLastAssistantPair: ComposerModelPick | null;
  assistantDefaultPair: ComposerModelPick | null;
  available: readonly ComposerModelPick[];
};

export function resolveComposerModel(
  input: ResolveComposerModelInput,
): ComposerModelPick | null {
  if (
    input.topicLastAssistantPair &&
    input.available.some((model) =>
      sameModelPick(model, input.topicLastAssistantPair),
    )
  ) {
    return input.topicLastAssistantPair;
  }
  if (
    input.assistantDefaultPair &&
    input.available.some((model) =>
      sameModelPick(model, input.assistantDefaultPair),
    )
  ) {
    return input.assistantDefaultPair;
  }
  return null;
}
