"use client";

import { useSyncExternalStore } from "react";

/**
 * Which topics currently have a live stream (send or regeneration),
 * maintained by the chat pool and consumed by the sidebar. Lives outside
 * the chat component tree so non-chat UI can subscribe without a
 * cross-domain component import.
 *
 * Session-scoped: a live stream only survives SPA navigations (a refresh
 * kills the fetch), so module state needs no persistence.
 */

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
  if (!streamingTopicIds.has(topicId)) {
    streamingTopicIds.add(topicId);
    emitStreamingStore();
  }
}

export function unmarkTopicStreaming(topicId: string): void {
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

/** Test hook: drop all module state between tests. */
export function resetStreamingTopics(): void {
  streamingTopicIds.clear();
  emitStreamingStore();
}
