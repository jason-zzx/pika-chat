import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";

import type { FileExtractionState } from "@/lib/schemas/file";
import {
  searchModeSchema,
  type SearchMode,
} from "@/lib/schemas/search-provider";

export type ComposerModelPick = {
  configId: string;
  modelId: string;
};

/**
 * Image-generation parameter overrides for one draft, mirrored into the
 * `image` request field when the picked model advertises image output.
 * All fields optional: absent means the provider default. Session-only like
 * drafts (not persisted) — switching drafts restores each draft's own picks,
 * matching how draft text and staged attachments behave.
 */
export type ComposerImageParams = {
  size?: string;
  n?: number;
  quality?: string;
  imageSize?: string;
};

/** Extraction metadata for an uploaded attachment (mirrors the API response). */
export type AttachmentExtraction = {
  status: FileExtractionState;
  truncated: boolean;
};

/**
 * A file staged in the composer for the current draft. `file` is the original
 * browser File kept in memory so a failed upload can be retried; attachments
 * are session-only client state and are never persisted (see `partialize`).
 */
export type StagedAttachment = {
  id: string;
  file: File;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  status: "uploading" | "ready" | "error";
  /** Canonical `/api/files/<id>` url once uploaded. */
  url?: string;
  extraction?: AttachmentExtraction;
  /** Thrown API/client error, resolved to copy at render time. */
  error?: unknown;
};

type ComposerState = {
  drafts: Record<string, string>;
  setDraft: (key: string, value: string) => void;
  attachments: Record<string, StagedAttachment[]>;
  updateAttachments: (
    key: string,
    updater: (current: StagedAttachment[]) => StagedAttachment[],
  ) => void;
  recentAssistantId: string | null;
  setRecentAssistantId: (id: string | null) => void;
  pickedModel: ComposerModelPick | null;
  setPickedModel: (pick: ComposerModelPick | null) => void;
  imageParams: Record<string, ComposerImageParams>;
  setImageParams: (key: string, params: ComposerImageParams) => void;
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
      attachments: {},
      updateAttachments: (key, updater) =>
        set((state) => ({
          attachments: {
            ...state.attachments,
            [key]: updater(state.attachments[key] ?? []),
          },
        })),
      recentAssistantId: null,
      setRecentAssistantId: (recentAssistantId) => set({ recentAssistantId }),
      pickedModel: null,
      setPickedModel: (pickedModel) => set({ pickedModel }),
      imageParams: {},
      setImageParams: (key, params) =>
        set((state) => ({
          imageParams: { ...state.imageParams, [key]: params },
        })),
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
      // Drafts, the model pick, and staged attachments stay session-only;
      // only the search mode survives reloads.
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
