import { create } from "zustand";

export type ComposerModelPick = {
  configId: string;
  modelId: string;
};

type ComposerState = {
  draft: string;
  setDraft: (draft: string) => void;
  recentAssistantId: string | null;
  setRecentAssistantId: (id: string | null) => void;
  pickedModel: ComposerModelPick | null;
  setPickedModel: (pick: ComposerModelPick | null) => void;
};

export const useComposerStore = create<ComposerState>((set) => ({
  draft: "",
  setDraft: (draft) => set({ draft }),
  recentAssistantId: null,
  setRecentAssistantId: (recentAssistantId) => set({ recentAssistantId }),
  pickedModel: null,
  setPickedModel: (pickedModel) => set({ pickedModel }),
}));
