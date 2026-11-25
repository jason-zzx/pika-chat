import { z } from "zod";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";

import type { ChatQuote } from "@/lib/schemas/chat";
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
 * All fields optional: absent means the provider default. Session-only (not
 * persisted, unlike draft text) — switching drafts restores each draft's own
 * picks, matching how staged attachments behave.
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
 * browser File kept in memory so a failed upload can be retried; it is absent
 * for referenced attachments (an already-uploaded file staged via "edit this
 * image" — nothing to upload or retry). `sizeBytes` is absent only for
 * referenced attachments whose source part carried no size (legacy rows).
 * Attachments are session-only client
 * state and are never persisted (see `partialize`).
 */
export type StagedAttachment = {
  id: string;
  file?: File;
  filename: string;
  mediaType: string;
  sizeBytes?: number;
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
  /** At most one quote per draft; quoting again replaces it, null removes it.
   * Session-only: unlike the draft text, it is not persisted. */
  quotes: Record<string, ChatQuote | null>;
  setQuote: (key: string, quote: ChatQuote | null) => void;
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

/**
 * Draft text (only the text) outlives the document: one localStorage item per
 * draft key, so tabs editing different topics never overwrite each other.
 * Attachments, quotes and image params stay session-only.
 */
const DRAFT_STORAGE_PREFIX = "pika.draft:";
const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const storedDraftSchema = z.object({ text: z.string(), updatedAt: z.number() });

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
      setDraft: (key, value) => {
        set((state) => ({
          drafts: { ...state.drafts, [key]: value },
        }));
        const storageKey = DRAFT_STORAGE_PREFIX + key;
        if (!value.trim()) {
          window.localStorage.removeItem(storageKey);
          return;
        }
        try {
          window.localStorage.setItem(
            storageKey,
            JSON.stringify({ text: value, updatedAt: Date.now() }),
          );
        } catch {
          // Quota exceeded (a huge paste): the draft still lives in memory
          // for this document, it just will not survive a reload.
        }
      },
      attachments: {},
      updateAttachments: (key, updater) =>
        set((state) => ({
          attachments: {
            ...state.attachments,
            [key]: updater(state.attachments[key] ?? []),
          },
        })),
      quotes: {},
      setQuote: (key, quote) =>
        set((state) => ({
          quotes: { ...state.quotes, [key]: quote },
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
      // The model pick and staged attachments stay session-only; the search
      // mode survives reloads here, draft text through its own per-key items.
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

/** Keeps stored drafts edited at or after `cutoff`, removes the rest, and
 * makes the kept ones the in-memory drafts. */
function pruneDrafts(cutoff: number): void {
  const kept: Record<string, string> = {};
  for (const storageKey of Object.keys(window.localStorage).filter((key) =>
    key.startsWith(DRAFT_STORAGE_PREFIX),
  )) {
    const stored = storedDraftSchema.safeParse(
      JSON.parse(window.localStorage.getItem(storageKey) ?? "null"),
    );
    if (stored.success && stored.data.updatedAt >= cutoff) {
      kept[storageKey.slice(DRAFT_STORAGE_PREFIX.length)] = stored.data.text;
      continue;
    }
    window.localStorage.removeItem(storageKey);
  }
  useComposerStore.setState({ drafts: kept });
}

// Restored after `create`, so `getInitialState()` keeps `drafts: {}`: zustand
// hands that to React as the hydration snapshot, and the stored text applies
// right after hydration without a mismatch. A draft expires 14 days after its
// last edit, or when it predates the native shell's last switch to this server.
if (typeof window !== "undefined") {
  pruneDrafts(
    Math.max(Date.now() - DRAFT_TTL_MS, window.pikaNative?.connectedSince ?? 0),
  );
}

/** An auth page means the session is gone; its unsent drafts go with it. */
export const discardComposerDrafts = () => pruneDrafts(Infinity);
