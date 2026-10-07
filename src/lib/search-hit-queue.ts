/**
 * One-shot hit-navigation payload handed from the search palette to the chat
 * view across a same-tab navigation. sessionStorage is consumed-and-deleted,
 * so the queue never leaks into shareable URLs or a later session (a refresh
 * after the `?m` param was stripped shows no navigator).
 */
export type SearchHitQueue = {
  topicId: string;
  /** groupIds of the same-topic message hits, in reading order (createdAt
   * asc — oldest first, top-to-bottom like the page). */
  hits: string[];
  /** The hit the user clicked; its position becomes the initial index. */
  current: string;
};

const STORAGE_KEY = "pika:search-hit-queue";

export function writeHitQueue(queue: SearchHitQueue): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // Storage unavailable (private mode/quota): the jump still works, only
    // the in-topic navigation is skipped.
  }
}

/** Validates a raw payload against the jump that just happened. Any mismatch
 * (stale queue of another topic, target not among the hits) drops it. */
export function parseHitQueue(
  raw: string | null,
  topicId: string,
  messageKey: string,
): { hits: string[]; index: number } | null {
  if (raw === null) {
    return null;
  }
  try {
    const queue = JSON.parse(raw) as SearchHitQueue;
    if (
      queue.topicId !== topicId ||
      !Array.isArray(queue.hits) ||
      !queue.hits.includes(messageKey)
    ) {
      return null;
    }
    const index = queue.hits.indexOf(queue.current);
    return {
      hits: queue.hits,
      index: index < 0 ? queue.hits.indexOf(messageKey) : index,
    };
  } catch {
    return null;
  }
}

/** Reads and deletes the stashed queue. Call exactly once, from the
 * confirmed-jump branch of the `?m` effect. */
export function consumeHitQueue(
  topicId: string,
  messageKey: string,
): { hits: string[]; index: number } | null {
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(STORAGE_KEY);
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    return null;
  }
  return parseHitQueue(raw, topicId, messageKey);
}
