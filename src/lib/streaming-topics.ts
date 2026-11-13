"use client";

import { useSyncExternalStore } from "react";

/**
 * Which topics currently have a live stream (send or regeneration),
 * maintained by the chat pool and consumed by the sidebar. Lives outside
 * the chat component tree so non-chat UI can subscribe without a
 * cross-domain component import.
 *
 * Not session-scoped any more: turns are server-owned, so the set is
 * reconciled from the server's active list (`syncServerStreamingTopics`) —
 * that is what shows the sidebar spinner for a turn started before this page
 * load, or in a topic this tab is not viewing. The pool's marks still take
 * effect immediately for the local optimistic path.
 */

const localTopicIds = new Set<string>();
const streamingTopicIds = new Set<string>();
let streamingSnapshot: ReadonlySet<string> = streamingTopicIds;
const storeListeners = new Set<() => void>();

function emitStreamingStore() {
  // A fresh Set per change: useSyncExternalStore compares snapshot identity.
  streamingSnapshot = new Set(streamingTopicIds);
  for (const listener of storeListeners) {
    listener();
  }
}

export function markTopicStreaming(topicId: string): void {
  localTopicIds.add(topicId);
  if (!streamingTopicIds.has(topicId)) {
    streamingTopicIds.add(topicId);
    emitStreamingStore();
  }
}

export function unmarkTopicStreaming(topicId: string): void {
  localTopicIds.delete(topicId);
  if (streamingTopicIds.delete(topicId)) {
    emitStreamingStore();
  }
}

function subscribeStreamingTopics(listener: () => void): () => void {
  storeListeners.add(listener);
  return () => storeListeners.delete(listener);
}

function streamingTopicsSnapshot(): ReadonlySet<string> {
  return streamingSnapshot;
}

/** Topic ids with a live background stream (send or regeneration). */
export function useStreamingTopics(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribeStreamingTopics,
    streamingTopicsSnapshot,
    streamingTopicsSnapshot,
  );
}

/** Current in-memory marks (the local optimistic set). */
export function localStreamingTopics(): ReadonlySet<string> {
  // Server-discovered topics are not local subscriptions. Returning the union
  // here makes every discovered topic immortal on the next reconciliation.
  return new Set(localTopicIds);
}

/**
 * Reconcile the set with the server's active generations.
 *
 * Topics owned by `local` (turns this tab started and whose stream it is
 * still following) are left alone: the pool unmarks them on finish, and
 * dropping them early would flicker the spinner.
 */
export function syncServerStreamingTopics(
  serverTopicIds: readonly string[],
  local: ReadonlySet<string>,
): void {
  let changed = false;
  for (const topicId of serverTopicIds) {
    if (!streamingTopicIds.has(topicId)) {
      streamingTopicIds.add(topicId);
      changed = true;
    }
  }
  for (const topicId of [...streamingTopicIds]) {
    if (!local.has(topicId) && !serverTopicIds.includes(topicId)) {
      streamingTopicIds.delete(topicId);
      changed = true;
    }
  }
  if (changed) {
    emitStreamingStore();
  }
}

/** Test hook: drop all module state between tests. */
export function resetStreamingTopics(): void {
  localTopicIds.clear();
  streamingTopicIds.clear();
  emitStreamingStore();
}
