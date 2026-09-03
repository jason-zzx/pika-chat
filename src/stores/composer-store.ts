import { create } from "zustand";

export type ComposerModelPick = {
  configId: string;
  modelId: string;
};

type ComposerState = {
  drafts: Record<string, string>;
  setDraft: (key: string, value: string) => void;
  recentAssistantId: string | null;
  setRecentAssistantId: (id: string | null) => void;
  pickedModel: ComposerModelPick | null;
  setPickedModel: (pick: ComposerModelPick | null) => void;
  reasoningEffort: string | null;
  setReasoningEffort: (effort: string | null) => void;
};

export function composerDraftKey(
  topicId: string | undefined,
  assistantId: string | undefined | null,
): string {
  if (topicId) {
    return `topic:${topicId}`;
  }
  return `draft:${assistantId ?? "none"}`;
}

export const useComposerStore = create<ComposerState>((set) => ({
  drafts: {},
  setDraft: (key, value) =>
    set((state) => ({
      drafts: { ...state.drafts, [key]: value },
    })),
  recentAssistantId: null,
  setRecentAssistantId: (recentAssistantId) => set({ recentAssistantId }),
  pickedModel: null,
  setPickedModel: (pickedModel) => set({ pickedModel }),
  reasoningEffort: null,
  setReasoningEffort: (reasoningEffort) => set({ reasoningEffort }),
}));
