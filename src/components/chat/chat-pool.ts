"use client";

import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

import type { ChatUIMessage } from "@/lib/schemas/chat";
import {
  markTopicStreaming,
  resetStreamingTopics,
  unmarkTopicStreaming,
} from "@/lib/streaming-topics";
import type { ComposerModelPick } from "@/stores/composer-store";

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
 * Resume scope is the SPA session: a page refresh aborts the fetch, the
 * server severs the provider stream (withDisconnectAbort), and the next
 * load reseeds from persisted history as before.
 */

export type ChatPoolSendContext = {
  shouldRequestTitle: boolean;
  titlePick: ComposerModelPick | null;
};

export type ChatPoolViewHandlers = {
  onData: (part: { type: string; data?: unknown }) => void;
  onFinish: (event: { isError: boolean }) => void;
};

export type PoolEntry = {
  chat: Chat<ChatUIMessage>;
  /** Effective topic: known at creation for topic chats, at `data-topic`
   * for drafts. Drives the sidebar status store and the finish-time query
   * invalidation. */
  topicId: string | null;
  /** Stream id of the in-flight send, for the Stop button of a resumed view. */
  streamId: string | null;
  /** A regeneration updates messages outside the Chat stream (manual fetch
   * loop), so `chat.status` stays "ready"; this flag keeps the entry alive
   * and the sidebar icon on until the loop's teardown. */
  regenActive: boolean;
  /** Which topic's history was last seeded into this chat. Lives on the
   * entry (not the view) so eviction discards it: a re-acquired chat starts
   * empty and must be reseeded, while a surviving entry must not be reseeded
   * over its live or newer messages. */
  seededFor: string | null;
  sendContext: ChatPoolSendContext | null;
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
  requestTitle: (topicId: string, pick: ComposerModelPick) => void;
};

const entries = new Map<string, PoolEntry>();
let bridge: ChatPoolBridge | null = null;
/** Title requests are deduped pool-wide so a resumed view cannot re-fire. */
const titleRequested = new Set<string>();

const transport = new DefaultChatTransport<ChatUIMessage>({
  api: "/api/chat",
  prepareSendMessagesRequest: ({ messages, body }) => ({
    body: {
      ...body,
      message: messages[messages.length - 1],
    },
  }),
});

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
    topicId: chatId === "draft" ? null : chatId,
    streamId: null,
    regenActive: false,
    seededFor: null,
    sendContext: null,
    view: null,
  };
  entry.chat = new Chat<ChatUIMessage>({
    id: chatId,
    transport,
    onData: (part) => {
      if (part.type === "data-topic") {
        const { topicId, streamId } = part.data;
        entry.topicId = topicId;
        entry.streamId = streamId;
        // A draft's send becomes this topic: move the entry so a later
        // visit to the topic URL resumes this very chat.
        if (entries.get(chatId) === entry && chatId !== topicId) {
          entries.delete(chatId);
          entries.set(topicId, entry);
        }
        markTopicStreaming(topicId);
        bridge?.invalidateTree();
        const context = entry.sendContext;
        if (
          context?.shouldRequestTitle &&
          context.titlePick &&
          !titleRequested.has(topicId)
        ) {
          titleRequested.add(topicId);
          bridge?.requestTitle(topicId, context.titlePick);
        }
        if (context) {
          context.shouldRequestTitle = false;
        }
      }
      entry.view?.onData(part);
    },
    onFinish: (event) => {
      entry.streamId = null;
      entry.sendContext = null;
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
      // A pre-stream failure never reaches onFinish; clear the bookkeeping
      // the same way or the sidebar icon would stick.
      entry.streamId = null;
      entry.sendContext = null;
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

/** Send-time context the module-level handlers need after the view is gone. */
export function noteSendStarted(
  chatId: string,
  context: ChatPoolSendContext,
): void {
  const entry = acquireChat(chatId);
  entry.sendContext = context;
  // Existing-topic sends know their topic immediately; drafts mark on
  // `data-topic` when the topic id arrives.
  if (entry.topicId) {
    markTopicStreaming(entry.topicId);
  }
}

/** A regeneration runs outside the Chat stream; bracket it explicitly. */
export function noteRegenStarted(chatId: string): void {
  const entry = acquireChat(chatId);
  entry.regenActive = true;
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
  if (entry.topicId) {
    unmarkTopicStreaming(entry.topicId);
  }
  maybeEvict(entry);
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
  titleRequested.clear();
  bridge = null;
  resetStreamingTopics();
}
