"use client";

import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

import { newId } from "@/lib/id";
import { generationStreamUrl } from "@/lib/api/generation";
import type { ChatUIMessage } from "@/lib/schemas/chat";
import {
  markTopicStreaming,
  resetStreamingTopics,
  unmarkTopicStreaming,
} from "@/lib/streaming-topics";

/**
 * Chat instance pool.
 *
 * `useChat` recreates its `Chat` whenever the `id` changes and drops the old
 * one without stopping it — the fetch keeps streaming in the background but
 * the accumulated messages and the streaming status become unreachable, so
 * returning to a topic mid-stream showed nothing until the history refetch
 * suddenly delivered the finished reply. The pool instead owns one `Chat`
 * per chat id ("draft" or a topic id): navigating away keeps the instance
 * (and its live stream) alive, and navigating back hands the same instance
 * to `useChat({ chat })`, which resubscribes to the still-accumulating
 * messages and the "streaming" status.
 *
 * Lifecycle: an entry is evicted when no ChatView is attached AND the chat
 * is idle (ready/error, no active regeneration), so the pool size stays
 * bounded by the number of live background streams. Finished streams are
 * evicted on detach; the next visit reseeds from the (already invalidated)
 * history query.
 *
 * Callback dispatch is two-level: module-level handlers (stream bookkeeping,
 * query invalidation via the registered bridge, sidebar status store) run
 * even when no view is attached; the attached ChatView's handlers run
 * afterwards for view-local effects (URL adoption, attachment restore).
 *
 * Resume scope is no longer the SPA session alone: the server owns the turn
 * (see `src/server/ai/generation-runner.ts`), so a refresh/closed tab only
 * drops this subscription. The view discovers the still-running generation
 * and re-attaches through the SDK's reconnect path
 * (`prepareReconnectToStreamRequest`), which replays the current answer state
 * into the placeholder message by id.
 */

export type ChatPoolViewHandlers = {
  onData: (part: { type: string; data?: unknown }) => void;
  onFinish: (event: { isError: boolean }) => void;
};

export type PoolEntry = {
  chat: Chat<ChatUIMessage>;
  /** The Chat instance's own id, fixed at creation. A draft's entry is
   * re-keyed to the created topic id, but the Chat keeps calling itself
   * "draft" — so the reconnect target must be looked up by this id, not by
   * the entry's current key. */
  chatId: string;
  /** Effective topic: known at creation for topic chats, at `data-topic`
   * for drafts. Drives the sidebar status store and the finish-time query
   * invalidation. */
  topicId: string | null;
  /** Durable generation id: the Stop handle and SDK reconnect target.
   * Retained across a network error so the turn can be re-adopted. */
  generationId: string | null;
  /** A reconnect request is open: dedupes discovery-driven re-attempts. */
  resumeInFlight: boolean;
  /** A regeneration updates messages outside the Chat stream (manual fetch
   * loop), so `chat.status` stays "ready"; this flag keeps the entry alive
   * and the sidebar icon on until the loop's teardown. */
  regenActive: boolean;
  /** Which topic's history was last seeded into this chat. Lives on the
   * entry (not the view) so eviction discards it: a re-acquired chat starts
   * empty and must be reseeded, while a surviving entry must not be reseeded
   * over its live or newer messages. */
  seededFor: string | null;
  view: ChatPoolViewHandlers | null;
};

/**
 * App-level side effects the pool cannot perform itself (it must stay
 * hook-free). Registered once by ChatPoolBridge under AppProviders; left
 * null in unit tests that render ChatView without the bridge.
 */
type ChatPoolBridge = {
  invalidateTree: () => void;
  invalidateAfterFinish: (topicId: string | null) => void;
};

const entries = new Map<string, PoolEntry>();
let bridge: ChatPoolBridge | null = null;

function createTransport(entry: PoolEntry) {
  return new DefaultChatTransport<ChatUIMessage>({
    api: "/api/chat",
    prepareSendMessagesRequest: ({ messages, body }) => ({
      body: {
        ...body,
        message: messages[messages.length - 1],
        // Per-action idempotency key (chat task §4, G2): the view mints one id
        // per user action and reuses it, so a retry of that same action can be
        // recognized by the server and a lost confirmation can be resolved by
        // request id instead of re-sending the model call.
        requestId:
          typeof body?.["requestId"] === "string"
            ? body["requestId"]
            : newId(),
      },
    }),
    // Reconnect goes to the generation stream, not to `/api/chat`: the server
    // replays the current answer state and continues the same turn.
    prepareReconnectToStreamRequest: () => {
      // Bind to the instance, not its immutable SDK id: multiple draft-created
      // chats can coexist with id="draft" after moving to different topic keys.
      const generationId = entry.generationId;
      return generationId ? { api: generationStreamUrl(generationId) } : {};
    },
  });
}

// --- Entry lifecycle -----------------------------------------------------

function isBusy(entry: PoolEntry): boolean {
  const status = entry.chat.status;
  return (
    status === "submitted" || status === "streaming" || entry.regenActive
  );
}

function maybeEvict(entry: PoolEntry) {
  if (entry.view !== null || isBusy(entry)) {
    return;
  }
  // Defer past the commit: topic navigations remount ChatView under React
  // StrictMode, which runs effect cleanup → setup back-to-back (detach →
  // re-attach the same chat). A synchronous eviction would drop the chat
  // the just-remounted view renders; the deferred check sees the re-attach.
  // A real switch-away has no re-attach, so eviction still fires.
  queueMicrotask(() => {
    if (entry.view !== null || isBusy(entry)) {
      return;
    }
    for (const [key, value] of entries) {
      if (value === entry) {
        entries.delete(key);
      }
    }
  });
}

function createEntry(chatId: string): PoolEntry {
  const entry: PoolEntry = {
    // Assigned below; the callbacks close over `entry` before `chat` exists,
    // but they only run once a stream starts — long after construction.
    chat: null as unknown as Chat<ChatUIMessage>,
    chatId,
    topicId: chatId === "draft" ? null : chatId,
    generationId: null,
    resumeInFlight: false,
    regenActive: false,
    seededFor: null,
    view: null,
  };
  entry.chat = new Chat<ChatUIMessage>({
    id: chatId,
    transport: createTransport(entry),
    onData: (part) => {
      if (part.type === "data-topic") {
        const { topicId, streamId } = part.data;
        entry.topicId = topicId;
        // `streamId` is the durable generation id (the server's task handle):
        // it drives the Stop button and the reconnect URL.
        entry.generationId = streamId;
        // A draft's send becomes this topic: move the entry so a later
        // visit to the topic URL resumes this very chat.
        if (entries.get(chatId) === entry && chatId !== topicId) {
          entries.delete(chatId);
          entries.set(topicId, entry);
        }
        markTopicStreaming(topicId);
        bridge?.invalidateTree();
      }
      entry.view?.onData(part);
    },
    onFinish: (event) => {
      // The SDK calls onError AND onFinish for a response-body disconnect.
      // Keeping the target only in onError loses it again in this callback.
      if (!event.isDisconnect) {
        entry.generationId = null;
      }
      if (entry.topicId) {
        unmarkTopicStreaming(entry.topicId);
      }
      // The server persists in its own onEnd before the response closes, so
      // by now a refetch returns the persisted row (including its error
      // detail for a failed turn).
      bridge?.invalidateAfterFinish(entry.topicId);
      try {
        entry.view?.onFinish({ isError: event.isError });
      } finally {
        maybeEvict(entry);
      }
    },
    onError: () => {
      // A pre-stream failure never reaches onFinish. The generation target is
      // KEPT: a network drop says nothing about the server-side turn, which
      // may still be running — discovery will re-adopt it through the same
      // reconnect URL. Only the local "streaming" mark is dropped, because
      // the server's active list is the authority for the sidebar spinner.
      if (entry.topicId) {
        unmarkTopicStreaming(entry.topicId);
      }
      maybeEvict(entry);
    },
  });
  return entry;
}

/** Get-or-create the pooled chat for a chat id ("draft" or a topic id). */
export function acquireChat(chatId: string): PoolEntry {
  let entry = entries.get(chatId);
  if (!entry) {
    entry = createEntry(chatId);
    entries.set(chatId, entry);
  }
  return entry;
}

/**
 * Record that this chat's messages were seeded from `topicId`'s history.
 * Mutations of the pooled entry live in this module: the React Compiler
 * forbids writes to render-scoped objects from callbacks and effects.
 */
export function markChatSeeded(entry: PoolEntry, topicId: string): void {
  entry.seededFor = topicId;
}

/** Force the next history arrival to reseed this chat (regen/delete paths). */
export function clearChatSeeded(entry: PoolEntry): void {
  entry.seededFor = null;
}

/**
 * True while a send stream or a regeneration owns the chat's messages — the
 * history seed must not clobber them with a stale fetch. Skipping the seed
 * deliberately leaves the seed guard unset: the finish-time invalidation
 * then reseeds once with the persisted (canonical) view.
 */
export function hasLiveChat(chatId: string): boolean {
  const entry = entries.get(chatId);
  return entry !== undefined && isBusy(entry);
}

/**
 * Attach the mounted ChatView's handlers. The returned cleanup detaches and
 * evicts the entry when the chat is idle (a busy entry outlives the view so
 * the stream can finish in the background).
 */
export function attachChatView(
  chatId: string,
  view: ChatPoolViewHandlers,
): () => void {
  const entry = acquireChat(chatId);
  entry.view = view;
  return () => {
    if (entry.view === view) {
      entry.view = null;
    }
    // Evict only when the entry is still registered under THIS chat id. A
    // draft entry migrates to its topic id on `data-topic`, and React runs
    // this cleanup (for the superseded "draft" key) right before the view
    // re-attaches under the topic id — evicting here would swap the live
    // chat for a fresh empty one.
    if (entries.get(chatId) === entry) {
      maybeEvict(entry);
    }
  };
}

/** Marks an existing topic streaming immediately when a send starts. */
export function noteSendStarted(chatId: string): void {
  const entry = acquireChat(chatId);
  // Existing-topic sends know their topic immediately; drafts mark on
  // `data-topic` when the topic id arrives.
  if (entry.topicId) {
    markTopicStreaming(entry.topicId);
  }
}

/** A regeneration runs outside the Chat stream; bracket it explicitly. */
export function noteRegenStarted(
  chatId: string,
  generationId?: string | null,
): void {
  const entry = acquireChat(chatId);
  entry.regenActive = true;
  if (generationId) {
    // The manual loop owns this generation: publishing the target keeps the
    // discovery-driven SDK resume from opening a SECOND consumer of the same
    // answer while the loop updates the message list itself.
    entry.generationId = generationId;
  }
  if (entry.topicId) {
    markTopicStreaming(entry.topicId);
  }
}

export function noteRegenFinished(chatId: string): void {
  const entry = entries.get(chatId);
  if (!entry) {
    return;
  }
  entry.regenActive = false;
  // The manual loop is over, so it no longer follows the turn. Releasing the
  // target lets discovery re-adopt a still-running generation (the loop can
  // die from a network error while the server keeps producing).
  entry.generationId = null;
  if (entry.topicId) {
    unmarkTopicStreaming(entry.topicId);
  }
  maybeEvict(entry);
}

/** Why a reconnect attempt did not end in a live attachment. */
export type ResumeOutcome =
  /** The turn streamed to its end (the finish handlers already ran). */
  | "finished"
  /** The server answered 204: nothing is live, refresh canonical history. */
  | "empty"
  /** The reconnect failed (network/HTTP); the target is kept for a retry. */
  | "failed"
  /** Another reconnect for this entry is already open. */
  | "busy";

/**
 * Attaches this view to a generation the server is already running, and asks
 * the SDK to reconnect. Used after a reload/closed tab: history has been
 * seeded (the placeholder row is in it), so the replayed state lands in that
 * row in place.
 *
 * The reconnect target is kept on failure — a dropped connection says nothing
 * about the turn — and only one reconnect per entry is open at a time, so the
 * discovery query can re-attempt safely.
 */
export async function resumeGeneration(
  chatId: string,
  generationId: string,
): Promise<ResumeOutcome> {
  const entry = acquireChat(chatId);
  if (entry.resumeInFlight) {
    return "busy";
  }
  entry.generationId = generationId;
  if (entry.topicId !== null) {
    markTopicStreaming(entry.topicId);
  }
  entry.resumeInFlight = true;
  try {
    await entry.chat.resumeStream();
  } catch {
    return "failed";
  } finally {
    entry.resumeInFlight = false;
  }
  if (entry.chat.status === "error") {
    return "failed";
  }
  if (entry.generationId === generationId) {
    // No finish chunk arrived and the SDK reported nothing to read: the
    // server had no live turn (204). Nothing was replayed.
    entry.generationId = null;
    if (entry.topicId !== null) {
      unmarkTopicStreaming(entry.topicId);
    }
    return "empty";
  }
  return "finished";
}

/** True when this chat already follows the given generation. */
export function isFollowingGeneration(
  chatId: string,
  generationId: string,
): boolean {
  const entry = entries.get(chatId);
  return entry !== undefined && entry.generationId === generationId;
}

/** Test hook: the reconnect URL the SDK would open for a chat id. */
export function reconnectTargetFor(chatId: string): string | null {
  const entry = entries.get(chatId) ??
    [...entries.values()].find(candidate => candidate.chatId === chatId);
  return entry?.generationId ?? null;
}

/** Register the app-level bridge; returns the dispose function. */
export function configureChatPool(api: ChatPoolBridge): () => void {
  bridge = api;
  return () => {
    if (bridge === api) {
      bridge = null;
    }
  };
}

/** Test hook: drop all module state between tests. */
export function resetChatPool(): void {
  entries.clear();
  bridge = null;
  resetStreamingTopics();
}
