import type { ComposerModelPick } from "@/stores/composer-store";

import { sameModelPick } from "./model-pick";

type ResolveComposerModelInput = {
  topicLastAssistantPair: ComposerModelPick | null;
  assistantDefaultPair: ComposerModelPick | null;
  /** The user's `chat` default-model preference — third in the chain, so an
   * assistant whose default model went stale still lands somewhere usable. */
  userDefaultPair: ComposerModelPick | null;
  available: readonly ComposerModelPick[];
};

export function resolveComposerModel(
  input: ResolveComposerModelInput,
): ComposerModelPick | null {
  for (const pair of [
    input.topicLastAssistantPair,
    input.assistantDefaultPair,
    input.userDefaultPair,
  ]) {
    if (pair && input.available.some((model) => sameModelPick(model, pair))) {
      return pair;
    }
  }
  return null;
}
