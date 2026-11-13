import "server-only";

import type { ChatChunk, LiveStreamState } from "@/server/ai/generation-stream";

/**
 * In-process registry of live generations (chat task §3 "进程内活跃任务").
 *
 * Deliberately a process-local map with no persistence: generation *identity*
 * and durable state live in PostgreSQL, while this holds only what a live
 * subscriber needs — the current message state, the abort handle and the
 * attached subscribers. One application instance owns its live turns;
 * cross-instance takeover is out of scope by design.
 */

/** Bounded per-subscriber queue. A consumer that cannot keep up with the
 * model is dropped instead of growing memory without limit (AC7). */
const MAX_PENDING_CHUNKS = 1_024;

export type GenerationSubscriber = {
  push: (chunk: ChatChunk) => void;
  /** Actual unread queue size; consumed chunks must not count against it. */
  pendingChunks: () => number;
  close: () => void;
};

export type LiveGeneration = {
  state: LiveStreamState;
  controller: AbortController;
  subscribers: Set<GenerationSubscriber>;
  status: "running" | "stopping";
  /** Set once the target was deleted: late output is dropped, not applied. */
  discarded: boolean;
  /**
   * The terminal chunk (finish/abort/error) held back until the final content is
   * committed, so a client never sees a turn finish before it is saved.
   */
  pendingTerminal: ChatChunk | null;
  /** Resolves after the terminal save attempt finished (shutdown waits on it). */
  settled: Promise<void>;
  markSettled: () => void;
};

// Match the runner's process-wide lifetime: HMR / separately evaluated route
// bundles must see the producer that is already running, not an empty new map.
const REGISTRY_KEY = Symbol.for("pika.generation-registry.live");
const holder = globalThis as unknown as Record<
  symbol,
  Map<string, LiveGeneration> | undefined
>;
const live = holder[REGISTRY_KEY] ??= new Map<string, LiveGeneration>();

/** Builds the entry the runner owns: state, abort handle, settlement signal. */
export function createLiveGeneration(input: {
  state: LiveStreamState;
  controller?: AbortController;
}): LiveGeneration {
  let markSettled: () => void = () => undefined;
  const settled = new Promise<void>((resolve) => {
    markSettled = resolve;
  });
  return {
    state: input.state,
    controller: input.controller ?? new AbortController(),
    subscribers: new Set(),
    status: "running",
    discarded: false,
    pendingTerminal: null,
    settled,
    markSettled,
  };
}

export function addLiveGeneration(entry: LiveGeneration): void {
  live.set(entry.state.generationId, entry);
}

export function removeLiveGeneration(generationId: string): void {
  live.delete(generationId);
}

export function getLiveGeneration(
  generationId: string,
): LiveGeneration | undefined {
  return live.get(generationId);
}

export function listLiveGenerations(): LiveGeneration[] {
  return [...live.values()];
}

/**
 * Drops every live turn of a deleted topic (chat task §8). The in-memory
 * content is cleared immediately and subscribers are closed, so an already
 * authorized connection cannot receive late chunks or a stale resume prefix,
 * and a partly built answer cannot be re-offered as a resume target.
 */
export function discardLiveGenerationsForTopic(topicId: string): void {
  for (const entry of live.values()) {
    if (entry.state.topicId !== topicId) {
      continue;
    }
    entry.discarded = true;
    entry.state.message.parts = [];
    entry.state.partIds.clear();
    entry.state.open.clear();
    entry.state.toolIndex.clear();
    entry.state.toolRaw.clear();
    entry.state.toolNames.clear();
    entry.pendingTerminal = null;
    entry.state.dirty = false;
    entry.status = "stopping";
    closeAllSubscribers(entry);
    entry.controller.abort();
  }
}

/**
 * Attaches a subscriber and hands it the current state as a standard chunk
 * prefix. The capture and the registration happen in one synchronous step, so
 * no chunk can be applied (and therefore lost) between them.
 *
 * Returns the unsubscribe handle; the caller closes its own stream.
 */
export function subscribeToLiveGeneration(
  entry: LiveGeneration,
  prefix: ChatChunk[],
  subscriber: GenerationSubscriber,
): () => void {
  const bounded: GenerationSubscriber = {
    pendingChunks: subscriber.pendingChunks,
    push: (chunk) => {
      if (subscriber.pendingChunks() >= MAX_PENDING_CHUNKS) {
        // Backlog too large: end this subscription only. The generation keeps
        // running for everyone else.
        subscriber.close();
        entry.subscribers.delete(bounded);
        return;
      }
      subscriber.push(chunk);
    },
    close: () => {
      subscriber.close();
      entry.subscribers.delete(bounded);
    },
  };
  for (const chunk of prefix) {
    subscriber.push(chunk);
  }
  entry.subscribers.add(bounded);
  return () => {
    entry.subscribers.delete(bounded);
  };
}

/** Fans one produced chunk out to every attached subscriber. */
export function publishChunk(entry: LiveGeneration, chunk: ChatChunk): void {
  for (const subscriber of [...entry.subscribers]) {
    subscriber.push(chunk);
  }
}

export function closeAllSubscribers(entry: LiveGeneration): void {
  for (const subscriber of [...entry.subscribers]) {
    subscriber.close();
  }
  entry.subscribers.clear();
}

/** Test hook: drop all module state between tests. */
export function resetLiveGenerations(): void {
  for (const entry of live.values()) {
    closeAllSubscribers(entry);
  }
  live.clear();
}
