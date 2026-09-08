import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";

import {
  searchModeSchema,
  type SearchMode,
} from "@/lib/schemas/search-provider";

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
  searchMode: SearchMode;
  setSearchMode: (mode: SearchMode) => void;
};

type PersistedComposerState = {
  searchMode: SearchMode;
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

// Server-side rendering has no localStorage; persist must stay silent there
// instead of warning on every SSR store creation.
const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

export const useComposerStore = create<ComposerState>()(
  persist(
    (set) => ({
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
      searchMode: "off",
      setSearchMode: (searchMode) => set({ searchMode }),
    }),
    {
      name: "pika-composer",
      version: 1,
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? noopStorage : window.localStorage,
      ),
      // Drafts and the model pick stay session-only; only the search mode
      // survives reloads.
      partialize: (state): PersistedComposerState => ({
        searchMode: state.searchMode,
      }),
      migrate: (persisted): PersistedComposerState => {
        const raw =
          typeof persisted === "object" &&
          persisted !== null &&
          "searchMode" in persisted
            ? persisted.searchMode
            : undefined;
        const parsed = searchModeSchema.safeParse(raw);
        return { searchMode: parsed.success ? parsed.data : "off" };
      },
    },
  ),
);
